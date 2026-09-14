# Sprint 1 — application des correctifs

Ordre volontaire : d'abord ce qui perd de l'argent, puis ce qui bloque le
process, puis ce qui est inexécutable, puis l'outillage qui empêche les trois
de revenir.

Estimation : 45 min d'application, plus le temps du test Stripe en mode test.

---

## 1. Route des démos (P0-4) — remplacement intégral

Remplacer `src/api/routes/demos.js` par le fichier fourni.

**Changements**
- `existsSync` + `readFileSync` → `res.sendFile()` : plus d'I/O synchrone dans
  la route publique la plus trafiquée.
- `await incrementViews()` déplacé **après** l'envoi de la réponse, en
  fire-and-forget, conforme à la convention du projet.
- Ajout de `X-Robots-Tag: noindex, nofollow`. Une démo non sollicitée ne doit
  pas être indexée ni concurrencer le référencement de l'entreprise. Si tu
  comptais au contraire t'appuyer sur l'indexation comme argument commercial,
  supprime cette ligne, c'est la seule qui change un comportement produit.

**Vérification**
```bash
curl -sI http://localhost:3000/demo/<un-slug-existant>
# attendu : 200, Content-Type text/html, CSP, X-Robots-Tag, ETag
curl -sI http://localhost:3000/demo/slug-qui-nexiste-pas   # attendu : 404
```
Puis ouvrir la démo deux fois et vérifier que le compteur de vues du dashboard
a bien avancé de 2.

---

## 2. Webhook Stripe (P0-3) — remplacement d'une section

Dans `src/api/routes/billing.js` :

1. **Import** — remplacer
   `import { authenticate } from '../middleware/auth.js';`
   par
   `import { authenticate, requireAdmin } from '../middleware/auth.js';`

2. **Bloc webhook** — supprimer tout depuis le commentaire
   `// ── Webhook Stripe ──…` jusqu'à `export default router;` **inclus**,
   puis coller la section 2 de `billing.webhook-section.js` (tout ce qui suit
   le commentaire « Bloc webhook » dans ce fichier).

Rien d'autre ne change : `CREDIT_PACKS`, `SUBSCRIPTION_PLANS`, `getStripe`,
`/checkout`, `/subscribe`, `/portal`, `/invoices` restent intacts.

**Ce que ça corrige** : une erreur applicative pendant le traitement renvoyait
200, donc Stripe n'a jamais réessayé, donc le client payait sans être crédité.
Désormais 500 → rejeu Stripe, sûr grâce à l'idempotence de `stripe_events`.

**Vérification (Stripe CLI, mode test)**
```bash
stripe listen --forward-to localhost:3000/billing/webhook
stripe trigger checkout.session.completed
```
Puis le cas qui compte, celui qui n'a jamais été testé :
```bash
# rendre la base non inscriptible une seconde le temps d'un événement
chmod 444 data/saas.db && stripe trigger checkout.session.completed
# attendu : 500 dans les logs stripe listen + une ligne logger.error
chmod 644 data/saas.db
# attendu : Stripe rejoue tout seul et crédite. Sinon, rejeu manuel :
curl -X POST http://localhost:3000/billing/replay/evt_xxx \
     -H "Authorization: Bearer <token admin>"
```

---

## 3. Scripts CLI (P0-1 et P0-2)

### 3a. Ajouter le client partagé
Déposer `scripts/lib/apiClient.js`, puis compléter `.env` et `.env.example` :
```
SCRIPT_EMAIL=compte-scripts@tondomaine.fr
SCRIPT_PASSWORD=…
```
Le compte doit avoir son email vérifié (`/generate` est derrière
`requireVerified`).

### 3b. `scripts/generateBulk.js`
1. **Supprimer entièrement la fonction `httpRequest`** (~40 lignes, section
   « HTTP HELPERS »). Elle contient `await import('node:https')` dans un
   exécuteur `new Promise((resolve, reject) => {…})` non-async : c'est une
   SyntaxError, le fichier ne se charge pas. Elle n'est appelée nulle part.
2. **Supprimer la fonction locale `apiFetch`** et la remplacer en tête de
   `main()` :
```js
import { createApiClient } from './lib/apiClient.js';

// …dans main(), en première ligne :
const { apiFetch, userId } = await createApiClient();
```
3. Retirer `USER_ID` et le bloc `if (!USER_ID) { … process.exit(1) }` :
   l'identité vient maintenant du login. Remplacer les usages de `USER_ID`
   dans les logs par `userId`.

### 3c. `scripts/pipeline.js`
Même traitement : supprimer la fonction `apiFetch` locale (celle qui pose
`'x-user-id': USER_ID`), importer `createApiClient`, et appeler
`const { apiFetch, userId } = await createApiClient();` en première ligne de
`main()`, avant `stepImport()`. Passer `apiFetch` aux trois étapes, ou le
stocker dans une variable de module assignée dans `main()`.

### 3d. `scripts/sendEmails.js` et `scripts/scrape.js`
Je ne les ai pas lus en entier. La règle est la même : toute occurrence de
`'x-user-id'` est morte, elle se remplace par le client partagé. Cherche :
```bash
grep -rn "x-user-id" scripts/
```
Il ne doit plus rien rester.

### 3e. Décision à prendre
Ces scripts font aujourd'hui doublon avec le dashboard et les queues
`scrape/generate/email`, qui font la même chose en asynchrone, avec retry et
reprise après crash. Si tu ne t'en sers plus, la bonne correction est
`git rm scripts/pipeline.js scripts/generateBulk.js scripts/sendEmails.js`.
Garder un script cassé qui se présente comme le pipeline principal est le pire
des deux mondes. Dis-moi lequel tu veux et je nettoie en conséquence.

---

## 4. Code mort (P1-9)

```bash
git rm src/services/creditService.js \
       src/services/leadService.js \
       src/services/analyticsService.js
```
Confirmé par `docs/scaling.md` : importés nulle part. Git garde l'historique.

Supprimer aussi dans `src/services/aiService.js` la dernière ligne :
```js
export { generateContent as generateAIContent };  // alias pour main.js (pipeline CLI)
```
**à condition** que `grep -rn "generateAIContent" src/ scripts/ tests/` ne
renvoie rien d'autre. Si `src/main.js` l'utilise encore, garder l'alias.

---

## 5. Outillage

Déposer `eslint.config.js` et `vitest.config.js` (si un `vitest.config.js`
existe déjà, ne reprendre que le bloc `coverage`), puis remplacer
`package.json` par la version fournie et :

```bash
npm install
npm run lint      # doit passer après les suppressions ci-dessus
npm test          # 112 tests, toujours verts
npm run test:coverage
```

`npm run lint` aurait attrapé le point 3b en une seconde. C'est la raison
d'être de cette étape.

### Correction de mon propre audit
J'avais recommandé de déclarer les dépendances optionnelles en
`optionalDependencies`. **C'est faux** : npm les installe par défaut, ce qui
imposerait Playwright (~300 Mo) à toute installation, exactement le contraire
de ton principe de dépendances paresseuses. La version livrée les laisse hors
installation et ajoute à la place :
```bash
npm run audit:optional   # les installe sans les sauvegarder, puis npm audit
```
À brancher dans la CI, en job séparé et non bloquant.

---

## 6. Après application

```bash
npm run check          # lint + tests
grep -rn "x-user-id" . --exclude-dir=node_modules   # doit être vide
git add -A && git commit -m "fix: webhook Stripe rejouable, route démo non bloquante, scripts CLI réauthentifiés, lint"
```

---

## Ce qui n'est PAS fait dans ce lot, volontairement

- **Test d'intégration de `/demo/:slug`.** Je ne connais pas le contrat exact
  de la route de création de lead (`POST /leads` : champs attendus, forme de la
  réponse). Écrire un test à l'aveugle serait du code approximatif. Colle-moi
  `src/api/routes/leads.js` ou le début de `tests/integration.test.js` et je
  livre le test dans la foulée : 200 + CSP + noindex, 404 sur slug inconnu,
  incrément de vues, et surtout le cas « site en base, fichier absent ».
- **Sprint 2** (domaine de démos dédié, TTL + purge, CSP des démos durcie,
  scraping en job, coût IA mesuré) : rien ici ne le bloque.
