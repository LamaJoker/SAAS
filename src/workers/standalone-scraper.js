/**
 * standalone-scraper.js — Worker scrape dans son propre process.
 *
 * Pourquoi : Playwright + Chromium consomment beaucoup de mémoire et peuvent
 * crasher. Isolés ici, un crash redémarre ce process (systemd Restart=always
 * ou docker restart) sans jamais toucher à l'API ni au site.
 *
 * Lancement : npm run worker:scrape
 * Côté API  : SCRAPE_WORKER_EXTERNAL=true (l'API enqueue, ne traite plus)
 */
import { createQueue }   from '../queue/createQueue.js';
import { scrapeHandler } from './scrapeWorker.js';
import { logger }        from '../utils/logger.js';

const queue = createQueue('scrape', {
  concurrency:  parseInt(process.env.SCRAPE_CONCURRENCY ?? '2'),
  maxRetries:   2,
  retryDelay:   2_000,
  pollInterval: 500,
});

const recovered = queue.recoverZombies();
if (recovered > 0) logger.warn(`[ScraperProcess] ${recovered} job(s) zombie(s) repris`);

queue.process(scrapeHandler);
logger.info('[ScraperProcess] Worker scrape autonome démarré');

const shutdown = async (signal) => {
  logger.info(`[ScraperProcess] ${signal} reçu — arrêt`);
  await queue.close();
  process.exit(0);
};
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT',  () => shutdown('SIGINT'));
