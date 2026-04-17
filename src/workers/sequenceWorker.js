/**
 * sequenceWorker.js — Worker périodique pour la séquence email
 *
 * Lance processSequence() toutes les 30 minutes.
 * Intégrable dans le process principal ou séparé.
 */

import { processSequence } from '../services/sequenceService.js';
import { logger }           from '../utils/logger.js';

const INTERVAL_MS = 30 * 60 * 1000; // 30 min

export function startSequenceWorker() {
  logger.info('[SequenceWorker] Started (interval: 30min)');

  // Premier run immédiat
  processSequence().then(s => logger.info('[SequenceWorker] Initial run', s)).catch(e => logger.error(e.message));

  const timer = setInterval(async () => {
    try {
      const stats = await processSequence();
      if (stats.sent > 0) logger.info('[SequenceWorker] Run complete', stats);
    } catch (err) {
      logger.error('[SequenceWorker] Error:', err.message);
    }
  }, INTERVAL_MS);

  timer.unref();
  return timer;
}
