/**
 * routes/queue.js — API de monitoring des queues
 *
 * GET  /queue/stats          → stats globales des 3 queues
 * GET  /queue/:type/jobs     → liste des jobs (par statut)
 * GET  /queue/:type/job/:id  → détail d'un job
 * POST /queue/:type/retry    → re-queue un job en erreur
 */

import express from 'express';
import { scrapeQueue, generateQueue, emailQueue } from '../workers/index.js';
import { Errors } from '../utils/AppError.js';

const router = express.Router();

const QUEUES = {
  scrape:   scrapeQueue,
  generate: generateQueue,
  email:    emailQueue,
};

function resolveQueue(type) {
  const q = QUEUES[type];
  if (!q) throw Errors.notFound(`Queue inconnue: ${type}`);
  return q;
}

// GET /queue/stats
router.get('/stats', (req, res) => {
  const stats = {};
  for (const [type, q] of Object.entries(QUEUES)) {
    stats[type] = q.getStats();
  }
  res.json({ success: true, data: stats });
});

// GET /queue/:type/jobs?status=pending&limit=20
router.get('/:type/jobs', (req, res, next) => {
  try {
    const q      = resolveQueue(req.params.type);
    const status = req.query.status ?? 'pending';
    const limit  = Math.min(100, parseInt(req.query.limit ?? '20'));

    const allowed = ['pending', 'processing', 'done', 'error', 'retrying'];
    if (!allowed.includes(status)) {
      return next(Errors.badRequest(`status doit être parmi: ${allowed.join(', ')}`));
    }

    const jobs = q.listJobs(status, limit);
    res.json({ success: true, data: jobs });
  } catch (err) {
    next(err);
  }
});

// GET /queue/:type/job/:id
router.get('/:type/job/:id', (req, res, next) => {
  try {
    const q   = resolveQueue(req.params.type);
    const job = q.getJob(req.params.id);
    if (!job) return next(Errors.notFound('Job introuvable'));
    res.json({ success: true, data: job });
  } catch (err) {
    next(err);
  }
});

// POST /queue/:type/retry  body: { jobId }
router.post('/:type/retry', (req, res, next) => {
  try {
    const q      = resolveQueue(req.params.type);
    const jobId  = req.body?.jobId;
    if (!jobId) return next(Errors.badRequest('jobId requis'));

    const ok = q.retry(jobId);
    if (!ok) return next(Errors.notFound('Job introuvable ou non en erreur'));

    res.json({ success: true, data: { retried: true, jobId } });
  } catch (err) {
    next(err);
  }
});

export default router;
