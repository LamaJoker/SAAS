import Database  from 'better-sqlite3';
import { config } from '../config/config.js';
import { mkdirSync } from 'fs';
import { dirname }   from 'path';
import { logger }    from '../utils/logger.js';

let db;

export function getDb() {
  if (!db) {
    mkdirSync(dirname(config.paths.db), { recursive: true });
    db = new Database(config.paths.db);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    db.pragma('busy_timeout = 5000');
    db.pragma('synchronous = NORMAL');
  }
  return db;
}

const MIGRATIONS = [
  {
    version: 1,
    name: 'initial_schema',
    sql: `
      CREATE TABLE IF NOT EXISTS users (
        id            TEXT PRIMARY KEY,
        email         TEXT UNIQUE NOT NULL,
        name          TEXT,
        credits       INTEGER NOT NULL DEFAULT 0,
        unsubscribed  INTEGER NOT NULL DEFAULT 0,
        created_at    TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS leads (
        id         TEXT PRIMARY KEY,
        user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        name       TEXT NOT NULL,
        activity   TEXT NOT NULL,
        city       TEXT NOT NULL,
        email      TEXT,
        phone      TEXT,
        status     TEXT NOT NULL DEFAULT 'pending'
          CHECK(status IN ('pending','processing','done','error')),
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS sites (
        id          TEXT PRIMARY KEY,
        lead_id     TEXT NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
        user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        slug        TEXT NOT NULL UNIQUE,
        output_path TEXT NOT NULL,
        url         TEXT NOT NULL,
        views       INTEGER NOT NULL DEFAULT 0,
        last_viewed TEXT,
        created_at  TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS events (
        id         TEXT PRIMARY KEY,
        type       TEXT NOT NULL,
        lead_id    TEXT REFERENCES leads(id) ON DELETE SET NULL,
        site_id    TEXT REFERENCES sites(id) ON DELETE SET NULL,
        user_id    TEXT REFERENCES users(id) ON DELETE SET NULL,
        meta       TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE INDEX IF NOT EXISTS idx_leads_user_status ON leads(user_id, status);
      CREATE INDEX IF NOT EXISTS idx_sites_slug        ON sites(slug);
      CREATE INDEX IF NOT EXISTS idx_sites_user        ON sites(user_id);
      CREATE INDEX IF NOT EXISTS idx_events_site       ON events(site_id);
      CREATE INDEX IF NOT EXISTS idx_events_type       ON events(type);
    `,
  },
  {
    version: 2,
    name: 'jobs_table',
    sql: `
      CREATE TABLE IF NOT EXISTS jobs (
        id          TEXT PRIMARY KEY,
        type        TEXT NOT NULL,
        status      TEXT NOT NULL DEFAULT 'pending'
          CHECK(status IN ('pending','processing','retrying','done','error')),
        data        TEXT NOT NULL,
        result      TEXT,
        error       TEXT,
        attempts    INTEGER NOT NULL DEFAULT 0,
        max_retries INTEGER NOT NULL DEFAULT 3,
        retry_delay INTEGER NOT NULL DEFAULT 5000,
        retry_at    TEXT,
        created_at  TEXT NOT NULL DEFAULT (datetime('now')),
        started_at  TEXT,
        finished_at TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_jobs_type_status ON jobs(type, status);
      CREATE INDEX IF NOT EXISTS idx_jobs_retry_at    ON jobs(retry_at);
    `,
  },
  {
    version: 3,
    name: 'email_tracking',
    sql: `
      CREATE TABLE IF NOT EXISTS email_events (
        id         TEXT PRIMARY KEY,
        token      TEXT NOT NULL UNIQUE,
        site_id    TEXT REFERENCES sites(id) ON DELETE SET NULL,
        lead_id    TEXT REFERENCES leads(id) ON DELETE SET NULL,
        variant    TEXT,
        event_type TEXT NOT NULL
          CHECK(event_type IN ('sent','open','click','click_registered')),
        url        TEXT,
        ip         TEXT,
        user_agent TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS email_sends (
        id         TEXT PRIMARY KEY,
        site_id    TEXT NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
        lead_id    TEXT NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
        variant_id TEXT NOT NULL,
        message_id TEXT NOT NULL,
        is_followup INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS email_blacklist (
        email      TEXT PRIMARY KEY,
        reason     TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE INDEX IF NOT EXISTS idx_ee_token    ON email_events(token);
      CREATE INDEX IF NOT EXISTS idx_ee_lead     ON email_events(lead_id);
      CREATE INDEX IF NOT EXISTS idx_ee_type     ON email_events(event_type);
      CREATE INDEX IF NOT EXISTS idx_es_site     ON email_sends(site_id);
    `,
  },
  {
    version: 4,
    name: 'user_password',
    sql: `
      ALTER TABLE users ADD COLUMN password_hash TEXT;
    `,
  },
  {
    version: 5,
    name: 'site_template',
    sql: `
      ALTER TABLE sites ADD COLUMN template TEXT NOT NULL DEFAULT 'moderne';
    `,
  },
  {
    version: 6,
    name: 'email_sequence',
    sql: `
      CREATE TABLE IF NOT EXISTS email_sequence (
        id           TEXT PRIMARY KEY,
        site_id      TEXT NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
        lead_id      TEXT NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
        step         INTEGER NOT NULL DEFAULT 0,
        status       TEXT NOT NULL DEFAULT 'pending'
          CHECK(status IN ('pending','sent','done','unsubscribed')),
        next_send_at TEXT,
        last_sent_at TEXT,
        score        INTEGER DEFAULT 0,
        created_at   TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_seq_next ON email_sequence(next_send_at, status);
      CREATE INDEX IF NOT EXISTS idx_seq_lead ON email_sequence(lead_id);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_seq_site ON email_sequence(site_id);
    `,
  },
  {
    version: 7,
    name: 'auth_lifecycle_and_crm',
    sql: `
      ALTER TABLE users ADD COLUMN email_verified INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE users ADD COLUMN verify_token TEXT;
      ALTER TABLE users ADD COLUMN reset_token TEXT;
      ALTER TABLE users ADD COLUMN reset_expires TEXT;
      ALTER TABLE users ADD COLUMN tokens_valid_after TEXT;

      -- Les comptes existants restent utilisables : on ne verrouille que les nouveaux
      UPDATE users SET email_verified = 1;

      ALTER TABLE leads ADD COLUMN pipeline TEXT NOT NULL DEFAULT 'nouveau';
      ALTER TABLE leads ADD COLUMN note TEXT;

      CREATE TABLE IF NOT EXISTS revoked_tokens (
        jti        TEXT PRIMARY KEY,
        expires_at TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_revoked_exp ON revoked_tokens(expires_at);
    `,
  },
  {
    version: 8,
    name: 'tenant_hardening_and_idempotence',
    sql: `
      -- Rôle admin explicite (accès /queue, /health/details)
      ALTER TABLE users ADD COLUMN is_admin INTEGER NOT NULL DEFAULT 0;

      -- Idempotence Stripe : un event.id déjà traité ne recrédite jamais
      CREATE TABLE IF NOT EXISTS stripe_events (
        event_id   TEXT PRIMARY KEY,
        type       TEXT,
        user_id    TEXT,
        credits    INTEGER,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      -- Déduplication leads : on supprime les doublons (même compte + même
      -- téléphone) en gardant le plus ancien, AVANT de poser l'index unique.
      DELETE FROM leads
      WHERE phone IS NOT NULL AND phone != ''
        AND rowid NOT IN (
          SELECT MIN(rowid) FROM leads
          WHERE phone IS NOT NULL AND phone != ''
          GROUP BY user_id, phone
        );

      CREATE UNIQUE INDEX IF NOT EXISTS idx_leads_user_phone
        ON leads(user_id, phone) WHERE phone IS NOT NULL AND phone != '';

      -- Index de performance (listes, analytics, hot leads)
      CREATE INDEX IF NOT EXISTS idx_leads_user_created ON leads(user_id, created_at);
      CREATE INDEX IF NOT EXISTS idx_ee_analytics       ON email_events(site_id, event_type, created_at);
      CREATE INDEX IF NOT EXISTS idx_events_user_type   ON events(user_id, type, created_at);
    `,
  },
  {
    version: 9,
    name: 'multichannel_and_apmp',
    sql: `
      -- Canal d'outreach par site : 'email' (défaut) ou 'whatsapp' (leads sans email)
      ALTER TABLE email_sequence ADD COLUMN channel TEXT NOT NULL DEFAULT 'email';

      -- Ouvertures machine (Apple Mail Privacy Protection, proxys) marquées à part
      -- pour distinguer le taux d'ouverture "humain" du taux brut.
      ALTER TABLE email_events ADD COLUMN is_machine INTEGER NOT NULL DEFAULT 0;

      -- Enrichissement : trace la provenance de l'email d'un lead
      ALTER TABLE leads ADD COLUMN email_source TEXT;
    `,
  },
  {
    version: 10,
    name: 'billing_subscriptions_invoices',
    sql: `
      -- Abonnement Stripe + coordonnées de facturation de l'acheteur
      ALTER TABLE users ADD COLUMN stripe_customer_id TEXT;
      ALTER TABLE users ADD COLUMN plan TEXT;
      ALTER TABLE users ADD COLUMN sub_status TEXT;        -- active | canceled | past_due
      ALTER TABLE users ADD COLUMN period_end TEXT;
      ALTER TABLE users ADD COLUMN billing_name TEXT;       -- raison sociale
      ALTER TABLE users ADD COLUMN billing_address TEXT;
      ALTER TABLE users ADD COLUMN billing_country TEXT;    -- code ISO2 (FR, DE…)
      ALTER TABLE users ADD COLUMN vat_number TEXT;         -- n° TVA intracom acheteur

      -- Factures : figées (snapshot acheteur), numérotation séquentielle légale
      CREATE TABLE IF NOT EXISTS invoices (
        id            TEXT PRIMARY KEY,
        number        TEXT NOT NULL UNIQUE,                 -- FACT-2026-0001
        user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        type          TEXT NOT NULL,                        -- pack | subscription
        description   TEXT,
        currency      TEXT NOT NULL DEFAULT 'eur',
        amount_ht     INTEGER NOT NULL,                     -- centimes
        vat_rate      REAL NOT NULL,
        vat_amount    INTEGER NOT NULL,
        amount_ttc    INTEGER NOT NULL,
        vat_note      TEXT,                                 -- mention légale éventuelle
        buyer_name    TEXT,
        buyer_address TEXT,
        buyer_country TEXT,
        buyer_vat     TEXT,
        stripe_ref    TEXT,
        issued_at     TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_invoices_user ON invoices(user_id, issued_at);
    `,
  },
  {
    version: 11,
    name: 'bounces_retention_lead_website',
    sql: `
      -- Rebonds email. Un hard bounce non traité = adresse morte re-sollicitée,
      -- c'est le moyen le plus rapide de faire brûler un domaine d'envoi.
      CREATE TABLE IF NOT EXISTS email_bounces (
        id         TEXT PRIMARY KEY,
        email      TEXT NOT NULL,
        type       TEXT NOT NULL CHECK(type IN ('hard','soft')),
        code       TEXT,                 -- statut DSN (5.1.1) ou code SMTP (550)
        diagnostic TEXT,                 -- extrait du Diagnostic-Code, tronqué
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_bounces_email ON email_bounces(email, created_at);

      -- Agrégat quotidien : conserve l'historique analytique quand les events
      -- bruts sont purgés (la table events grossit d'une ligne par ouverture,
      -- clic et vue de démo).
      CREATE TABLE IF NOT EXISTS events_daily (
        day     TEXT NOT NULL,
        user_id TEXT,
        type    TEXT NOT NULL,
        count   INTEGER NOT NULL,
        PRIMARY KEY (day, user_id, type)
      );

      -- \`website\` était accepté par Lead.create() et silencieusement perdu :
      -- la colonne n'existait pas.
      ALTER TABLE leads ADD COLUMN website TEXT;
    `,
  },

];

export function runMigrations() {
  const db = getDb();

  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version    INTEGER PRIMARY KEY,
      name       TEXT NOT NULL,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  const applied = new Set(
    db.prepare('SELECT version FROM schema_migrations').all().map(r => r.version)
  );

  const pending = MIGRATIONS.filter(m => !applied.has(m.version));
  if (!pending.length) {
    logger.info('[DB] Aucune migration en attente');
    return;
  }

  for (const migration of pending) {
    const run = db.transaction(() => {
      db.exec(migration.sql);
      db.prepare('INSERT INTO schema_migrations (version, name) VALUES (?, ?)')
        .run(migration.version, migration.name);
    });

    try {
      run();
      logger.info(`[DB] Migration v${migration.version} appliquée: ${migration.name}`);
    } catch (err) {
      throw new Error(`[DB] Migration v${migration.version} échouée: ${err.message}`);
    }
  }
}
