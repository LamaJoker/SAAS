import { createQueue }     from '../queue/createQueue.js';
import { scrapeHandler }   from './scrapeWorker.js';
import { generateHandler } from './generateWorker.js';
import { emailHandler }    from './emailWorker.js';
import { logger }          from '../utils/logger.js';

// SCRAPE_WORKER_EXTERNAL=true : le scraping (Playwright + Chromium, gourmand
// et crashable) tourne dans un process séparé (npm run worker:scrape).
// L'API continue d'ENQUEUER les jobs scrape, elle ne les traite juste plus.
const SCRAPE_EXTERNAL = process.env.SCRAPE_WORKER_EXTERNAL === 'true';

export const scrapeQueue = createQueue('scrape', {
  concurrency:  5,
  maxRetries:   2,
  retryDelay:   2_000,
  pollInterval: 500,
});

export const generateQueue = createQueue('generate', {
  concurrency:  parseInt(process.env.GEN_CONCURRENCY ?? '3'),
  maxRetries:   3,
  retryDelay:   10_000,
  pollInterval: 1_000,
});

export const emailQueue = createQueue('email', {
  concurrency:  2,
  maxRetries:   4,
  retryDelay:   60_000,
  retryBackoff: 3,
  pollInterval: 2_000,
});

export function startScrapeWorker()   { scrapeQueue.process(scrapeHandler);     logger.info('Worker scrape démarré'); }
export function startGenerateWorker() { generateQueue.process(generateHandler); logger.info('Worker generate démarré'); }
export function startEmailWorker()    { emailQueue.process(emailHandler);       logger.info('Worker email démarré'); }

export function startAllWorkers() {
  // Recovery des zombies UNIQUEMENT pour les types traités par CE process :
  // si le scraper est externe, ses jobs en cours ne doivent pas être volés.
  const queues = [generateQueue, emailQueue, ...(SCRAPE_EXTERNAL ? [] : [scrapeQueue])];
  let recovered = 0;
  for (const q of queues) recovered += q.recoverZombies();
  if (recovered > 0) {
    logger.warn(`[Workers] ${recovered} job(s) zombie(s) remis en file d'attente`);
  }

  startGenerateWorker();
  startEmailWorker();
  if (SCRAPE_EXTERNAL) {
    logger.info('Worker scrape externe (SCRAPE_WORKER_EXTERNAL=true) — lancez: npm run worker:scrape');
  } else {
    startScrapeWorker();
  }
  logger.info('Tous les workers démarrés');
}

export async function stopAllWorkers() {
  logger.info('Arrêt des workers…');
  await Promise.all([scrapeQueue.close(), generateQueue.close(), emailQueue.close()]);
  logger.info('Workers arrêtés');
}
