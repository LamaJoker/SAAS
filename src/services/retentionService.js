/**
 * retentionService.js — Rétention des données d'événements.
 *
 * Le problème
 * ───────────
 * `events` et `email_events` reçoivent une ligne par ouverture, par clic et par
 * vue de démo. À 50 000 emails par mois, la base atteint plusieurs millions de
 * lignes en un an : les requêtes analytics se dégradent en silence, les backups
 * gonflent, et `email_events` conserve indéfiniment des adresses IP et des
 * user-agents de personnes qui n'ont jamais rien demandé.
 *
 * La réponse
 * ──────────
 * Les événements bruts sont agrégés dans `events_daily` (jour × compte × type)
 * AVANT d'être supprimés : les statistiques historiques survivent, le détail
 * nominatif non. C'est aussi ce que demande le principe de minimisation du
 * RGPD : conserver la mesure, pas la trace individuelle.
 *
 * Configuration :
 *   RETENTION_DAYS   nombre de jours de détail conservé (défaut 365, 0 = jamais purger)
 */
import { getDb } from '../db/database.js';
import { logger } from '../utils/logger.js';

const DEFAULT_DAYS = 365;

export function retentionDays() {
  const raw = parseInt(process.env.RETENTION_DAYS ?? String(DEFAULT_DAYS), 10);
  return Number.isFinite(raw) && raw >= 0 ? raw : DEFAULT_DAYS;
}

/**
 * Agrège puis purge les événements antérieurs à la fenêtre de rétention.
 * Tout se fait en une transaction : jamais de suppression sans agrégat.
 *
 * @param {number} [days] surcharge la config (utile en test)
 * @returns {{ rolledUp: number, eventsDeleted: number, emailEventsDeleted: number, skipped?: true }}
 */
export function purgeOldEvents(days = retentionDays()) {
  if (days === 0) return { rolledUp: 0, eventsDeleted: 0, emailEventsDeleted: 0, skipped: true };

  const db = getDb();
  const cutoff = `-${parseInt(days, 10)} days`;

  const run = db.transaction(() => {
    // user_id peut être NULL : SQLite considère deux NULL comme distincts dans
    // une clé primaire, l'agrégat se dupliquerait à chaque passage. COALESCE
    // ramène tout sur une valeur comparable.
    const rolledUp = db.prepare(`
      INSERT INTO events_daily (day, user_id, type, count)
      SELECT date(created_at), COALESCE(user_id, ''), type, COUNT(*)
        FROM events
       WHERE created_at < datetime('now', ?)
       GROUP BY 1, 2, 3
      ON CONFLICT(day, user_id, type) DO UPDATE SET count = count + excluded.count
    `).run(cutoff).changes;

    const eventsDeleted = db.prepare(
      "DELETE FROM events WHERE created_at < datetime('now', ?)"
    ).run(cutoff).changes;

    // email_events porte IP et user-agent : c'est la table la plus volumineuse
    // et la plus sensible. Les compteurs agrégés vivent dans email_sends.
    const emailEventsDeleted = db.prepare(
      "DELETE FROM email_events WHERE created_at < datetime('now', ?)"
    ).run(cutoff).changes;

    return { rolledUp, eventsDeleted, emailEventsDeleted };
  });

  const result = run();
  if (result.eventsDeleted || result.emailEventsDeleted) {
    logger.info('[Retention] Purge effectuée', { days, ...result });
  }
  return result;
}

/** Purge quotidienne, 20 min après le boot pour ne pas concurrencer le backup. */
export function startRetentionScheduler() {
  const DAY = 24 * 3_600_000;
  const safePurge = () => {
    try { purgeOldEvents(); }
    catch (err) { logger.error('[Retention] Purge échouée', { error: err.message }); }
  };

  const first = setTimeout(() => {
    safePurge();
    const interval = setInterval(safePurge, DAY);
    interval.unref();
  }, 20 * 60_000);
  first.unref();
}
