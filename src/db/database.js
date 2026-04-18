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
