import express from 'express';
import { scrapeQueue, generateQueue, emailQueue } from '../../workers/index.js';
import { Errors } from '../../utils/AppError.js';

const router  = express.Router();
const QUEUES  = { scrape: scrapeQueue, generate: generateQueue, email: emailQueue };

function resolveQueue(type) {
  const q = QUEUES[type];
  if (!q) throw Errors.notFound(`Queue inconnue: ${type}. Valeurs: ${Object.keys(QUEUES).join(', ')}`);
  return q;
}

router.get('/stats', (req, res) => {
  const stats = Object.fromEntries(
    Object.entries(QUEUES).map(([type, q]) => [type, q.getStats()])
  );
  res.json({ success: true, data: stats });
});

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

router.post('/:type/retry', (req, res, next) => {
  try {
    const q     = resolveQueue(req.params.type);
    const jobId = req.body?.jobId;
    if (!jobId) return next(Errors.badRequest('jobId requis'));
    const ok = q.retry(jobId);
    if (!ok) return next(Errors.notFound('Job introuvable ou non en erreur'));
    res.json({ success: true, data: { retried: true, jobId } });
  } catch (err) {
    next(err);
  }
});

export default router;
