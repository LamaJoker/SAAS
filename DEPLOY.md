# Déploiement AutoDemo SaaS

Guide de mise en production. Deux options : **Docker** (recommandé) ou **systemd**.

---

## 1. Prérequis

- Un serveur Linux (1 vCPU / 1 Go suffisent pour démarrer).
- Un nom de domaine pointant (A record) vers l'IP du serveur.
- Un compte SMTP transactionnel (le point critique — voir §4).

---

## 2. Configuration

```bash
cp .env.example .env
# Au minimum, remplir :
#   JWT_SECRET   → openssl rand -hex 48
#   BASE_URL     → https://votre-domaine.fr
#   CORS_ORIGIN  → https://votre-domaine.fr
#   AI_API_KEY   → sinon mode mock (sites génériques)
#   SMTP_*       → sinon aucun email ne part
```

`validateConfig()` refuse de démarrer si `JWT_SECRET`, `BASE_URL` ou `CORS_ORIGIN`
sont absents en production : c'est volontaire.

---

## 3. Lancement

### Option A — Docker (recommandé)

1. Mettre votre domaine dans `Caddyfile` (remplacer `votre-domaine.fr`).
2. `docker compose up -d --build`

Caddy obtient et renouvelle le certificat HTTPS automatiquement. L'app n'est
jamais exposée directement : tout passe par le proxy.

```bash
docker compose logs -f app      # logs application
docker compose ps               # état + healthcheck
docker compose down             # arrêt
```

### Option B — systemd (sans Docker)

```bash
sudo useradd -r -s /bin/false autodemo
sudo mkdir -p /opt/autodemo && sudo cp -r . /opt/autodemo
cd /opt/autodemo && npm ci --omit=dev
sudo chown -R autodemo:autodemo /opt/autodemo
sudo cp deploy/autodemo.service /etc/systemd/system/
sudo systemctl daemon-reload && sudo systemctl enable --now autodemo
```

Mettre un reverse proxy HTTPS devant (Caddy/nginx) vers `127.0.0.1:3000`.

---

## 4. Délivrabilité email — LE prérequis n°1

Sans ces 3 enregistrements DNS, ~70 % des emails partent en spam et tout le
produit perd sa valeur. À configurer sur le domaine d'envoi :

| Enregistrement | Type | Exemple de valeur |
|---|---|---|
| **SPF**   | TXT sur `domaine.fr`              | `v=spf1 include:votre-smtp.com ~all` |
| **DKIM**  | TXT sur `default._domainkey.domaine.fr` | clé publique fournie / générée |
| **DMARC** | TXT sur `_dmarc.domaine.fr`       | `v=DMARC1; p=quarantine; rua=mailto:dmarc@domaine.fr` |

Générer une paire DKIM et activer la signature côté app :
```bash
openssl genrsa -out dkim_private.pem 2048
openssl rsa -in dkim_private.pem -pubout            # → publier la clé publique en DNS
# .env : DKIM_DOMAIN=domaine.fr  DKIM_SELECTOR=default  DKIM_PRIVATE_KEY="$(cat dkim_private.pem)"
```

Vérifier après coup (admin) : `GET /health/deliverability` → `all_green: true`.

Recommandé au lancement : `WARMUP_ENABLED=true` (montée en volume progressive).

---

## 5. Premier admin

Aucun compte n'est admin par défaut. Après inscription :
```bash
# Docker :
docker compose exec app node -e "import('./src/db/database.js').then(({getDb})=>getDb().prepare(\"UPDATE users SET is_admin=1 WHERE email=?\").run('vous@domaine.fr'))"
```
Donne accès à `/queue/*` et `/health/details`.

---

## 6. Dépendances optionnelles (fonctionnalités activables)

| Fonction | Installer | Activer (.env) |
|---|---|---|
| Paiement Stripe   | `npm i stripe`      | `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` |
| Scraper Maps      | `npm i playwright && npx playwright install chromium` | route `/scrape` |
| WhatsApp          | `npm i twilio`      | `WHATSAPP_ENABLED=true` + `TWILIO_*` |
| Poller IMAP       | `npm i imapflow`    | `INBOUND_ENABLED=true` + `IMAP_*` |

État en direct : onglet **Intégrations** du dashboard, ou `GET /features`.

---

## 7. Sauvegardes & restauration

Backup SQLite quotidien automatique → `data/backups/` (7 conservés, `BACKUP_KEEP`).
Manuel : `npm run backup`.

**Restauration** : arrêter l'app, remplacer `data/saas.db` par un fichier de
`data/backups/`, supprimer `saas.db-wal`/`saas.db-shm`, redémarrer.

```bash
docker compose cp app:/app/data/backups ./backups-local   # exfiltrer hors serveur
```
⚠️ Copier régulièrement les backups **hors du serveur** (disque en panne = perte totale).

---

## 8. Supervision

- **Liveness** : `GET /health` (public, minimal) — à brancher sur Uptime Kuma / LB.
- **Détail** : `GET /health/details` (admin) — queues, SMTP, mémoire, alertes.
- **Alertes** : `ERROR_WEBHOOK_URL` (Slack/Discord) → notifié sur erreur 500 / crash.
- **Logs** : `logs/app.log` (rotation 5 Mo, rétention `LOG_RETENTION_DAYS`).

---

## 9. Mise à l'échelle

Mono-instance par défaut (SQLite + rate-limiter mémoire) — suffisant très loin.
Quand le besoin est mesuré (cf. `docs/scaling.md`) :

- **Rate limiter partagé** : `npm i ioredis`, `RATE_LIMIT_DRIVER=redis` + `REDIS_URL`.
- **Queue distribuée** : `npm i bullmq ioredis`, `QUEUE_DRIVER=bullmq` + `REDIS_URL`
  (vérifier en staging contre un vrai Redis).
- **Scraper isolé** : `SCRAPE_WORKER_EXTERNAL=true` + `npm run worker:scrape`.
- **PostgreSQL** (pour ≥ 2 instances applicatives) : migration dédiée décrite
  dans `docs/scaling.md` (SQLite est un fichier local, donc bloquant pour le
  vrai horizontal scale). Plan par étapes pour ne rien casser.
