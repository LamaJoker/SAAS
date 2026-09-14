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
import { exec } from 'node:child_process';

const KEEP = parseInt(process.env.BACKUP_KEEP ?? '7');

/**
 * Commande exécutée après chaque backup réussi. Le chemin du fichier est exposé
 * dans la variable d'environnement $BACKUP_FILE (jamais concaténé dans la
 * commande : un nom de fichier ne peut donc pas s'y injecter).
 *
 * Pourquoi ce n'est pas un client S3 intégré : un backup qui reste sur le même
 * disque que la base ne protège de rien — ni d'une panne disque, ni d'un rm -rf,
 * ni d'un ransomware. Mais coder un client de stockage dans l'app ajouterait une
 * dépendance lourde et des identifiants à gérer, pour une tâche que rclone, aws
 * ou scp font mieux. La commande est donc déléguée, et chiffrée côté opérateur.
 *
 * Exemple (chiffrement puis envoi) :
 *   BACKUP_POST_CMD='gpg --batch --yes -r backup@vous.fr -e "$BACKUP_FILE" && rclone copy "$BACKUP_FILE".gpg remote:saas-backups && rm -f "$BACKUP_FILE".gpg'
 */
const POST_CMD = process.env.BACKUP_POST_CMD ?? '';
const POST_CMD_TIMEOUT_MS = parseInt(process.env.BACKUP_POST_TIMEOUT_MS ?? '300000');

/**
 * Exécute la commande d'externalisation. Ne jette jamais : un envoi hors-site
 * raté ne doit pas empêcher le backup local, qui lui a déjà réussi. L'échec est
 * loggé en erreur, donc relayé vers ERROR_WEBHOOK_URL s'il est configuré.
 */
function runPostCommand(dest) {
  if (!POST_CMD) return Promise.resolve(false);

  return new Promise(resolve => {
    exec(POST_CMD, {
      timeout: POST_CMD_TIMEOUT_MS,
      shell: '/bin/sh',
      env: { ...process.env, BACKUP_FILE: dest },
    }, (err, stdout, stderr) => {
      if (err) {
        logger.error('[Backup] Externalisation échouée', {
          error: err.message, stderr: String(stderr).slice(0, 500),
        });
        return resolve(false);
      }
      logger.info('[Backup] Externalisation réussie', { dest });
      resolve(true);
    });
  });
}

export async function backupDatabase() {
  const backupDir = join(dirname(config.paths.db), 'backups');
  mkdirSync(backupDir, { recursive: true });

  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  const dest  = join(backupDir, `saas-${stamp}.db`);

  await getDb().backup(dest);
  logger.info('[Backup] Base sauvegardée', { dest });

  // Externalisation : le chemin est passé via $BACKUP_FILE.
  await runPostCommand(dest);

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
