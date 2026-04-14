/**
 * workers/index.js — Registre des workers
 *
 * Crée et expose les trois queues du pipeline :
 *   scrapeQueue   → import / validation des leads
 *   generateQueue → génération IA + build HTML
 *   emailQueue    → envoi des emails de prospection
 *
 * Chaque worker est indépendant : on peut les lancer séparément
 * ou tous ensemble via startAllWorkers().
 */

import { Queue }            from '../queue/Queue.js';
import { scrapeHandler }    from './scrapeWorker.js';
import { generateHandler }  from './generateWorker.js';
import { emailHandler }     from './emailWorker.js';
import { logger }           from '../utils/logger.js';

// ── Queue instances ──────────────────────────────────────────────────────────

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
  retryDelay:   60_000,   // 1 min before first email retry
  retryBackoff: 3,        // aggressive back-off for SMTP
  pollInterval: 2_000,
});

// ── Start helpers ────────────────────────────────────────────────────────────

export function startScrapeWorker()    { scrapeQueue.process(scrapeHandler);       logger.info('Scrape worker started'); }
export function startGenerateWorker()  { generateQueue.process(generateHandler);   logger.info('Generate worker started'); }
export function startEmailWorker()     { emailQueue.process(emailHandler);         logger.info('Email worker started'); }

export function startAllWorkers() {
  startScrapeWorker();
  startGenerateWorker();
  startEmailWorker();
  logger.info('All workers started');
}

export async function stopAllWorkers() {
  logger.info('Stopping all workers…');
  await Promise.all([
    scrapeQueue.close(),
    generateQueue.close(),
    emailQueue.close(),
  ]);
  logger.info('All workers stopped');
}
