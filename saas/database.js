import Database from 'better-sqlite3';
import { config } from '../config/config.js';
import { mkdirSync } from 'fs';
import { dirname } from 'path';
import { logger } from '../utils/logger.js';

let db;

export function getDb() {
  if (!db) {
    mkdirSync(dirname(config.paths.db), { recursive: true });
    db = new Database(config.paths.db);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    db.pragma('busy_timeout = 5000');
  }
  return db;
}

export function runMigrations() {
  const db = getDb();

  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id         TEXT PRIMARY KEY,
      email      TEXT UNIQUE NOT NULL,
      name       TEXT,
      credits    INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS leads (
      id         TEXT PRIMARY KEY,
      user_id    TEXT NOT NULL REFERENCES users(id),
      name       TEXT NOT NULL,
      activity   TEXT NOT NULL,
      city       TEXT NOT NULL,
      email      TEXT,
      phone      TEXT,
      status     TEXT NOT NULL DEFAULT 'pending',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS sites (
      id          TEXT PRIMARY KEY,
      lead_id     TEXT NOT NULL REFERENCES leads(id),
      user_id     TEXT NOT NULL REFERENCES users(id),
      slug        TEXT NOT NULL UNIQUE,
      output_path TEXT NOT NULL,
      url         TEXT NOT NULL,
      status      TEXT NOT NULL DEFAULT 'generated',
      views       INTEGER NOT NULL DEFAULT 0,
      last_viewed TEXT,
      created_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_sites_slug    ON sites(slug);
    CREATE INDEX IF NOT EXISTS idx_sites_user_id ON sites(user_id);
    CREATE INDEX IF NOT EXISTS idx_leads_user_id ON leads(user_id);
  `);

  logger.info('Migrations exécutées');
}
