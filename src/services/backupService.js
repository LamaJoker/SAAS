/**
 * backupService.js — Sauvegarde de la base SQLite
 *
 * Utilise l'API backup native de better-sqlite3 (cohérente même en WAL,
 * sans verrouiller les écritures). Un backup par jour, 7 conservés.
 *
 * Manuel : npm run backup
 */
import { getDb }   from '../db/database.js';
import { config }  from '../config/config.js';
import { logger }  from '../utils/logger.js';
import { mkdirSync, readdirSync, unlinkSync } from 'fs';
import { join, dirname } from 'path';

const KEEP = parseInt(process.env.BACKUP_KEEP ?? '7');

export async function backupDatabase() {
  const backupDir = join(dirname(config.paths.db), 'backups');
  mkdirSync(backupDir, { recursive: true });

  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  const dest  = join(backupDir, `saas-${stamp}.db`);

  await getDb().backup(dest);
  logger.info('[Backup] Base sauvegardée', { dest });

  // Rotation : ne garder que les KEEP plus récents
  const files = readdirSync(backupDir)
    .filter(f => f.startsWith('saas-') && f.endsWith('.db'))
    .sort()
    .reverse();
  for (const old of files.slice(KEEP)) {
    try { unlinkSync(join(backupDir, old)); } catch {}
  }

  return dest;
}

/** Backup quotidien automatique (démarre 5 min après le boot pour ne pas ralentir). */
export function startBackupScheduler() {
  const DAY = 24 * 3_600_000;
  const first = setTimeout(() => {
    backupDatabase().catch(err => logger.error('[Backup] Échec', { error: err.message }));
    const interval = setInterval(
      () => backupDatabase().catch(err => logger.error('[Backup] Échec', { error: err.message })),
      DAY
    );
    interval.unref();
  }, 5 * 60_000);
  first.unref();
}
