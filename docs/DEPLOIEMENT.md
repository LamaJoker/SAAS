# Déploiement en production

## Option A — Docker (recommandé)

```bash
docker build -t autodemo .
docker volume create autodemo-data
docker volume create autodemo-output
docker run -d --name autodemo --restart unless-stopped \
  -p 127.0.0.1:3000:3000 \
  --env-file .env \
  -v autodemo-data:/app/data \
  -v autodemo-output:/app/output \
  autodemo
```

## Option B — systemd (VPS nu)

`/etc/systemd/system/autodemo.service` :

```ini
[Unit]
Description=AutoDemo SaaS
After=network.target

[Service]
Type=simple
User=autodemo
WorkingDirectory=/opt/autodemo
ExecStart=/usr/bin/node src/main.js
Restart=always
RestartSec=5
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl enable --now autodemo
```

## Reverse proxy HTTPS — Caddy (le plus simple)

`/etc/caddy/Caddyfile` :

```
votredomaine.fr {
    reverse_proxy 127.0.0.1:3000
}
```

Caddy obtient et renouvelle le certificat Let's Encrypt automatiquement.
Le `app.set('trust proxy', 1)` du serveur est déjà configuré pour lire
`X-Forwarded-For` derrière ce proxy.

## Variables d'environnement obligatoires en production

| Variable | Rôle |
|---|---|
| `NODE_ENV=production` | Active les validations strictes de config |
| `JWT_SECRET` | ≥ 32 caractères aléatoires (`openssl rand -hex 48`) |
| `BASE_URL` | `https://votredomaine.fr` — utilisé dans les emails et URLs de démo |
| `CORS_ORIGIN` | `https://votredomaine.fr` |
| `AI_API_KEY` | Clé OpenAI (ou compatible) pour la génération de contenu |
| `SMTP_HOST/USER/PASS` | Envoi d'emails (séquence + transactionnels) |

Optionnelles : `STRIPE_SECRET_KEY` + `STRIPE_WEBHOOK_SECRET` (paiements),
`SMTP_POOL_JSON` (plusieurs comptes d'envoi), `COLD_EMAIL_PERSONAL=allow`
(autoriser les adresses gmail/orange — voir DELIVRABILITE.md),
`LOG_TO_FILE=false` (conteneur), `BACKUP_KEEP` (nb de backups conservés).

## Sauvegardes

- Automatique : un backup SQLite par jour dans `data/backups/`, 7 conservés.
- Manuel : `npm run backup`.
- **Copiez `data/backups/` hors du serveur** (rclone vers S3/Backblaze, ou
  simple `rsync` cron vers une autre machine). Un backup sur le même disque
  ne protège pas d'une panne disque.

## Scraper Google Maps (optionnel)

```bash
npm i playwright
npx playwright install chromium --with-deps
```

Sans Playwright, la route `/scrape` répond 503 proprement — le reste de
l'application fonctionne normalement.

## Checklist avant ouverture

- [ ] `NODE_ENV=production` + toutes les variables ci-dessus
- [ ] HTTPS actif (Caddy/nginx)
- [ ] SPF/DKIM/DMARC configurés → voir `DELIVRABILITE.md`
- [ ] Backup externe planifié
- [ ] `/health` surveillé (Uptime Kuma, BetterStack…) — alerte si `status != ok`
