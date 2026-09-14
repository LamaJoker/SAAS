# 🏗️ AutoDemo SaaS

> Génère automatiquement des sites vitrines pour PME locales, puis les démarche par séquence email — de la prospection au paiement.

[![CI](https://github.com/LamaJoker/SAAS/actions/workflows/ci.yml/badge.svg)](https://github.com/LamaJoker/SAAS/actions/workflows/ci.yml)
[![Tests](https://img.shields.io/badge/tests-146%20passing-brightgreen)](#-tests)
[![Node](https://img.shields.io/badge/Node-%E2%89%A518-339933?logo=node.js&logoColor=white)](https://nodejs.org)
[![Express](https://img.shields.io/badge/Express-4.19-000000?logo=express&logoColor=white)](https://expressjs.com)
[![SQLite](https://img.shields.io/badge/SQLite-%E2%86%92%20PostgreSQL--ready-003B57?logo=sqlite&logoColor=white)](#-base-de-données)
[![Docker](https://img.shields.io/badge/Docker-Caddy%20HTTPS-2496ED?logo=docker&logoColor=white)](#-déploiement)

AutoDemo est une plateforme d'acquisition B2B de bout en bout : elle **scrape** des prospects (Google Maps), **génère** un site démo personnalisé par IA, puis lance une **séquence d'emails** de prospection avec suivi des ouvertures/clics, CRM, facturation Stripe et conformité RGPD.

---

## 👀 Voir le résultat

**[→ Exemples de sites générés](https://lamajoker.github.io/SAAS/)** — trois sorties réelles du générateur (un template chacun), produites à partir d'une seule ligne de données : nom, activité, ville.

Pour faire tourner l'application complète sans clé API ni configuration :

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/LamaJoker/SAAS)

Le blueprint démarre en mode simulation (`AI_MOCK_MODE=true`) : le dashboard, la génération de sites, le CRM et les analytics fonctionnent sans dépendance externe.

---

## 🧭 Décisions d'ingénierie

Le code seul ne dit pas pourquoi il est écrit ainsi. [**`docs/DECISIONS.md`**](docs/DECISIONS.md) détaille huit décisions structurantes avec leur **coût**, pas seulement leur bénéfice — SQLite plutôt que PostgreSQL, dépendances minimales, effets de bord non bloquants, pourquoi un webhook de paiement doit échouer bruyamment, classification hard/soft des rebonds email, et ce qui reste volontairement ouvert.

---

## ✨ Fonctionnalités

| Domaine | Capacités |
| --- | --- |
| **Acquisition** | Scraper Google Maps (Playwright), enrichissement email, déduplication des leads par tenant |
| **Génération** | 3 templates de sites (`moderne`, `elegant`, `vibrant`), génération IA avec validation de schéma (Zod), écriture atomique |
| **Outreach** | Séquence J0 / J+3 / J+7, variantes A/B réelles, canal WhatsApp optionnel, signature DKIM, warmup progressif, filtre Apple Mail Privacy |
| **CRM** | Pipeline 6 statuts, timeline des interactions, hot leads triés par urgence, actions un-clic depuis l'email de notif (token HMAC) |
| **Réponses entrantes** | Webhook + poller IMAP optionnel → arrêt auto de la séquence, passage en « à rappeler » |
| **Paiement** | Stripe (packs de crédits + abonnements), factures séquentielles avec TVA (domestique / autoliquidation UE / export), portail client |
| **Analytics** | Tracking pixel + clics, taux d'ouverture humain (hors APMP), dashboard temps réel |
| **Conformité** | Auth scrypt, JWT cookie HttpOnly, isolation multi-tenant, export RGPD (art. 20), pages légales, désinscription HMAC, mentions CAN-SPAM |
| **Ops** | Logs fichier + rotation, backups SQLite quotidiens, crash handlers, alerting webhook, rate limiting pluggable |

---

## 🏛️ Architecture

```
saas/
├── src/
│   ├── api/
│   │   ├── routes/         # 20 routeurs Express (auth, leads, sites, billing, crm, tracking…)
│   │   └── middleware/     # auth (cookie/Bearer), rate limiter, validation Zod, error handler
│   ├── services/           # logique métier (génération, email, scraping, facturation, IA…)
│   ├── workers/            # queue : génération, envoi email, scraping, séquence, poller inbound
│   ├── queue/              # abstraction queue (SQLite par défaut, BullMQ optionnel)
│   ├── db/                 # database.js (SQLite + migrations), repo/queries async, schéma PostgreSQL
│   ├── email/              # façade de rendu + variantes + footer de désinscription
│   └── utils/              # password (scrypt), tokens HMAC, logger, AppError
├── templates/              # 3 templates de sites vitrines
├── frontend/               # dashboard + landing (HTML/CSS/JS statiques, CSP stricte)
├── tests/                  # 19 fichiers Vitest + supertest + pg-mem (146 tests)
├── docs/                   # décisions d'ingénierie, déploiement, délivrabilité, scaling
└── deploy/                 # systemd + Docker + Caddy
```

### Stack technique

| Couche | Choix | Raison |
| --- | --- | --- |
| Runtime | Node.js 18+ (ESM) | Natif, sans transpilation |
| API | Express 4 | Standard, middleware riche |
| Base de données | better-sqlite3 (→ PostgreSQL-ready) | Zéro config en dev, montée en charge documentée |
| Auth | scrypt + JWT cookie HttpOnly | Sans dépendance crypto externe, anti-XSS |
| Validation | Zod 4 | Schémas partagés entrées API + réponses IA |
| Email | Nodemailer 8 + pool SMTP multi-comptes | Rotation, DKIM, warmup |
| Scraping | Playwright (lazy) | Chargé seulement si activé |
| Paiement | Stripe (lazy) | Webhooks idempotents |
| Tests | Vitest + supertest + pg-mem | Unitaires, intégration HTTP, PostgreSQL sans Docker |
| Déploiement | Docker + Caddy (HTTPS auto) | Reverse-proxy + TLS automatique |

---

## 🚀 Démarrage rapide

### Prérequis

- Node.js ≥ 18

### Installation

```bash
git clone https://github.com/LamaJoker/SAAS.git
cd SAAS
npm install

# Configurer l'environnement
cp .env.example .env
# Générer un secret JWT : openssl rand -hex 48
# Éditer .env (au minimum JWT_SECRET)

# Lancer
npm start          # → http://localhost:3000
npm run dev        # mode watch
```

> **Mode démo sans clés** : sans `AI_API_KEY`, l'app génère des sites en mode mock. Sans SMTP, les comptes sont auto-vérifiés. Tout le cœur fonctionne hors-ligne en SQLite.

### Créer un admin

```bash
npm run make-admin
# ou : UPDATE users SET is_admin = 1 WHERE email = '...';
```

---

## 🧪 Tests

```bash
npm test           # 146 tests, 19 fichiers (Vitest)
npm run test:watch
npm run test:coverage
npm run lint       # 0 erreur
```

Couverture des tests :

- **Unitaires** — scrypt, tokens HMAC (unsub / crm), scoring, TVA & factures, rendu email (golden master), validation de schéma IA, conformité légale
- **Intégration** (supertest) — auth par cookie, isolation multi-tenant, génération transactionnelle + crédits, arrêt de séquence sur formulaire de contact, gating admin, webhook entrant
- **PostgreSQL** (pg-mem) — requêtes paramétrées, déduplication par index partiel, idempotence `ON CONFLICT`, claim de jobs `UPDATE … RETURNING`
- **Cas limites qui font mal en production** — rebonds email (DSN Postfix / Gmail / Exchange, classification hard vs soft), site présent en base mais fichier disparu du disque, purge qui doit épargner un lead engagé commercialement, agrégation avant suppression des événements

---

## 🗄️ Base de données

SQLite par défaut (migrations versionnées appliquées au démarrage). Le projet est **PostgreSQL-ready** : schéma consolidé (`src/db/schema.postgres.sql`), adaptateur async (`src/db/pg.js`) et façade repository (`src/db/repo.js`) déjà en place. Le plan de bascule (impedance sync → async, transactions métier) est documenté dans [`docs/scaling.md`](docs/scaling.md).

```bash
npm run migrate      # applique les migrations SQLite
npm run migrate:pg   # applique le schéma PostgreSQL (si DATABASE_URL)
npm run backup       # backup SQLite manuel (auto quotidien sinon)
```

---

## 🔒 Sécurité

- **Auth** scrypt (sel + coût configurable), anti-énumération, rate limiting sur le login
- **Sessions** JWT en cookie `HttpOnly` `SameSite=Lax` ; blocklist `jti` + invalidation globale après reset de mot de passe
- **Multi-tenant** : repositories et requêtes scopés au `user_id` (pas de fuite cross-tenant, vérifié en test)
- **CSP stricte** sur le frontend (`script-src 'self'`, scripts externalisés, aucune ligne inline)
- **Stripe** : webhooks idempotents (table `stripe_events`, crédit en transaction)
- **Secrets** : `.env` jamais commité, aucun secret hardcodé, `.env.example` documente toutes les variables

---

## 📦 Déploiement

Docker Compose avec Caddy (HTTPS automatique) :

```bash
docker compose up -d
```

Runbook complet (config, SPF/DKIM/DMARC, backups/restore, supervision, scaling) dans [`DEPLOY.md`](DEPLOY.md). Service systemd durci fourni dans [`deploy/`](deploy/).

---

## 📚 Documentation

- [`docs/DECISIONS.md`](docs/DECISIONS.md) — **décisions d'ingénierie et arbitrages** (à lire en premier)
- [`DEPLOY.md`](DEPLOY.md) — déploiement de A à Z
- [`docs/DELIVRABILITE.md`](docs/DELIVRABILITE.md) — délivrabilité email (SPF / DKIM / DMARC / warmup)
- [`docs/scaling.md`](docs/scaling.md) — ADR de migration PostgreSQL & montée en charge

---

## 📄 Licence

Code source publié à des fins de démonstration (portfolio). Tous droits réservés © 2026.
