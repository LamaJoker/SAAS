# Scalabilité — état & décisions

## Ce qui est livré (multi-instance partiel)

| Blocage initial | Statut | Activation |
|---|---|---|
| Rate limiter en mémoire | ✅ Redis pluggable (fail-open) | `RATE_LIMIT_DRIVER=redis` + `REDIS_URL` + `npm i ioredis` |
| Queue SQLite mono-process | ✅ Adaptateur BullMQ/Redis | `QUEUE_DRIVER=bullmq` + `REDIS_URL` + `npm i bullmq ioredis` |
| Scraper dans le process API | ✅ Process séparé | `SCRAPE_WORKER_EXTERNAL=true` + `npm run worker:scrape` |
| Workers in-process | ✅ Claim atomique (`UPDATE…RETURNING`) | déjà multi-process safe en SQLite |
| Schéma PostgreSQL | ✅ écrit + **vérifié contre pg-mem** (`tests/postgres.test.js`) | `src/db/schema.postgres.sql` |
| Connexion/transactions PG | ✅ adaptateur async (`src/db/pg.js`) | `DB_DRIVER=postgres` + `DATABASE_URL` + `npm i pg` |
| CI/CD | ✅ tests Node 20/22 + audit + build Docker | `.github/workflows/ci.yml` |

Avec Redis (rate limiter + BullMQ), le **plan de contrôle** est partageable.
Le **plan de données** PostgreSQL a sa cible prête (schéma validé, connexion async) ;
reste la **bascule applicative** ci-dessous.

## Le vrai blocage restant : la base de données

SQLite est un **fichier local**. Deux instances applicatives sur deux machines
ne peuvent pas écrire le même fichier. Le multi-instance horizontal **réel**
exige donc PostgreSQL (ou une base réseau).

### Pourquoi ce n'est pas un simple « remplacer le driver »

Le code repose **intégralement** sur l'API **synchrone** de `better-sqlite3` :

```js
const row = db.prepare('SELECT …').get(id);   // synchrone
db.transaction(() => { … })();                // transaction synchrone
```

`pg` (PostgreSQL) est **asynchrone**. La migration impose donc :

1. Rendre **asynchrones** toutes les méthodes des modèles (`User`, `Lead`, `Site`,
   `Event`, `Queue`) et **tous leurs appelants** (`await` partout).
2. Réécrire les **transactions métier** (numérotation de facture, génération de
   site, idempotence Stripe) avec un client `pg` dédié (`BEGIN/COMMIT` async +
   checkout d'une connexion du pool) — la garantie d'atomicité actuelle est
   synchrone.
3. Convertir les **accès directs** `getDb().prepare(...)` disséminés dans les
   routes (dashboard, tracking, billing, leads, crm, inbound…).
4. Adapter le SQL spécifique SQLite (`datetime('now', …)`, `INSERT OR IGNORE`,
   `UPDATE…RETURNING`, `julianday`, index partiels) vers PostgreSQL.

C'est une refonte transversale (~tout le `src/db` + appelants), à **vérifier
contre un vrai PostgreSQL**. La mener à la hâte casserait l'app et les 93 tests
verts. Elle mérite une itération dédiée, pas un fourre-tout.

### Fait

- ✅ **Schéma PostgreSQL** (`src/db/schema.postgres.sql`) : les 10 migrations
  SQLite consolidées en dialecte PG (TIMESTAMPTZ, index partiels, CHECK…).
- ✅ **Vérifié** contre un vrai moteur Postgres en mémoire (`pg-mem`,
  `tests/postgres.test.js`) : requêtes paramétrées, dédup par index partiel,
  idempotence `ON CONFLICT`, claim `UPDATE…RETURNING`, unicité des n° de facture.
- ✅ **Connexion async** (`src/db/pg.js`) : pool, `pgQuery`, `pgTransaction`,
  `applyPgSchema` (lazy `pg`, dormant tant que `DB_DRIVER=sqlite`).

### Bascule applicative — par étapes

1. ✅ **Façade repository async** (`src/db/repo.js`) au-dessus de SQLite : méthodes
   `async` enveloppant l'API sync, `this` préservé. **Tous les appels aux modèles
   (User/Lead/Site/Event) hors transaction migrés vers `await repo.*`** dans les
   services, workers et routes du chemin requête. Les 108 tests restent verts ;
   flux complet vérifié en live. Base inchangée (SQLite).
   - Restent volontairement sync (étape 3) : le contenu des `db.transaction()`
     (siteService, billing webhook) — réécriture avec `pgTransaction` le jour J.
   - Dead code laissé tel quel : credit/lead/analyticsService (importés nulle part).
2. ✅ **SQL brut sorti des ROUTES** vers `src/db/queries.js` (module async unique) :
   dashboard, analytics, timeline, export RGPD, contact, unsubscribe, tracking
   (open/click/stats). Routes appellent `await queries.*`. Ne restent dans les
   routes que `billing.js` (transaction Stripe, → étape 3) et `health.js` (sonde
   `SELECT 1`, bas niveau). 112 tests verts + smoke live (unsubscribe, pixel,
   dashboard).
2b. ✅ **SQL des SERVICES non-transactionnels + middleware auth** sorti vers
   `queries.js` : notifyService (staleHotLeads/markHotLeadReminded), inboundService
   (findLeadsByEmail/recordInboundReply), emailService (countEmailsForSite/
   lastEmailDaysAgo/isEmailBlacklisted/recordEmailSent/sitesForEmailQueue) ;
   `auth.js` passé **async** (authenticate/requireVerified/requireAdmin via repo +
   isTokenRevoked ; revokeToken via revokeJti). 112 tests verts + smoke live (auth
   cookie, requireVerified, requireAdmin, révocation au logout). Reste hors
   data-layer : SQL transaction-couplé (billing/siteService/invoiceService/
   sequenceService → étape 3), trackingService (pixels), Queue.js (→ BullMQ),
   backup/scraper (infra), code mort.
3. ⏳ **Brancher l'adaptateur PG** (`src/db/pg.js`, déjà écrit + vérifié pg-mem)
   derrière la même façade, sélection `DB_DRIVER`. Réécrire les transactions
   métier avec `pgTransaction`. **Nécessite un PostgreSQL de staging.**
4. ⏳ **Bascule** : export SQLite → import PostgreSQL, vérifier en staging.

### Quand migrer (pas avant)

- ≥ 2 instances applicatives sur des machines différentes, **ou**
- contention d'écriture SQLite visible (`SQLITE_BUSY` récurrents), **ou**
- besoin de réplicas en lecture / haute dispo.

En dessous, **SQLite (WAL) + Redis** tient très loin : une seule instance bien
dimensionnée gère des milliers d'utilisateurs. Ne pas payer la complexité
PostgreSQL avant d'en avoir le besoin mesuré.
