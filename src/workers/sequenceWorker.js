/**
 * sequenceWorker.js — Worker périodique pour la séquence email
 *
 * Lance processSequence() toutes les 30 minutes.
 * Intégrable dans le process principal ou séparé.
 */

import { processSequence }     from '../services/sequenceService.js';
import { remindStaleHotLeads } from '../services/notifyService.js';
import { logger }              from '../utils/logger.js';

const INTERVAL_MS = 30 * 60 * 1000; // 30 min

async function tick() {
  const stats = await processSequence();
  if (stats.sent > 0) logger.info('[SequenceWorker] Run complete', stats);
  // SLA prospects chauds : rappel au propriétaire si non traité depuis +1h
  await remindStaleHotLeads();
}

export function startSequenceWorker() {
  logger.info('[SequenceWorker] Started (interval: 30min)');

  // Premier run immédiat
  tick().then(() => logger.info('[SequenceWorker] Initial run done')).catch(e => logger.error(e.message));

  const timer = setInterval(async () => {
    try {
      await tick();
    } catch (err) {
      logger.error('[SequenceWorker] Error:', err.message);
    }
  }, INTERVAL_MS);

  timer.unref();
  return timer;
}
