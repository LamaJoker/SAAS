import { Queue }           from '../queue/Queue.js';
import { scrapeHandler }   from './scrapeWorker.js';
import { generateHandler } from './generateWorker.js';
import { emailHandler }    from './emailWorker.js';
import { logger }          from '../utils/logger.js';

export const scrapeQueue = new Queue('scrape', {
  concurrency:  5,
  maxRetries:   2,
  retryDelay:   2_000,
  pollInterval: 500,
});

export const generateQueue = new Queue('generate', {
  concurrency:  parseInt(process.env.GEN_CONCURRENCY ?? '3'),
  maxRetries:   3,
  retryDelay:   10_000,
  pollInterval: 1_000,
});

export const emailQueue = new Queue('email', {
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
  startScrapeWorker();
  startGenerateWorker();
  startEmailWorker();
  logger.info('Tous les workers démarrés');
}

export async function stopAllWorkers() {
  logger.info('Arrêt des workers…');
  await Promise.all([scrapeQueue.close(), generateQueue.close(), emailQueue.close()]);
  logger.info('Workers arrêtés');
}
