/**
 * pg.js — Connexion PostgreSQL (cible multi-instance, cf docs/scaling.md).
 *
 * Adaptateur ASYNCHRONE : c'est le cœur de la différence avec better-sqlite3
 * (synchrone). La bascule de l'app suppose que la couche d'accès aux données
 * passe en async (chantier décrit dans docs/scaling.md). `pg` est chargé
 * paresseusement → aucune dépendance imposée tant que DB_DRIVER=sqlite.
 *
 * Activation : DB_DRIVER=postgres + DATABASE_URL + `npm i pg`.
 */
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { logger } from '../utils/logger.js';

const SCHEMA_PATH = join(dirname(fileURLToPath(import.meta.url)), 'schema.postgres.sql');

let pool = null;

export async function getPgPool() {
  if (pool) return pool;
  const { default: pg } = await import('pg');
  pool = new pg.Pool({
    connectionString: process.env.DATABASE_URL,
    max: parseInt(process.env.PG_POOL_MAX || '10'),
  });
  pool.on('error', (err) => logger.error('[PG] Pool error', { error: err.message }));
  return pool;
}

/** Requête paramétrée ($1, $2…) → tableau de lignes. */
export async function pgQuery(text, params = []) {
  const p = await getPgPool();
  const res = await p.query(text, params);
  return res.rows;
}

/** Transaction async (remplace db.transaction() synchrone de SQLite). */
export async function pgTransaction(fn) {
  const p = await getPgPool();
  const client = await p.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/** Applique le schéma (idempotent : tout est CREATE … IF NOT EXISTS). */
export async function applyPgSchema() {
  const sql = readFileSync(SCHEMA_PATH, 'utf8');
  const p = await getPgPool();
  await p.query(sql);
  logger.info('[PG] Schéma appliqué');
}

export function pgSchemaSql() {
  return readFileSync(SCHEMA_PATH, 'utf8');
}
