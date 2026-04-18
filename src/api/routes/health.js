import express from 'express';
import { getDb }        from '../../db/database.js';
import { smtpPool }     from '../../services/smtpPool.js';
import { scrapeQueue, generateQueue, emailQueue } from '../../workers/index.js';

const router = express.Router();

router.get('/', (req, res) => {
  let dbOk = false;
  try {
    getDb().prepare('SELECT 1').get();
    dbOk = true;
  } catch {}

  const smtpStats  = smtpPool.isConfigured ? smtpPool.getStats() : [];
  const smtpActive = smtpStats.filter(s => s.healthy).length;

  res.json({
    status:  dbOk ? 'ok' : 'degraded',
    uptime:  Math.round(process.uptime()),
    db:      dbOk ? 'connected' : 'error',
    smtp:    { configured: smtpPool.isConfigured, active: smtpActive, total: smtpStats.length },
    queues:  {
      scrape:   scrapeQueue.getStats(),
      generate: generateQueue.getStats(),
      email:    emailQueue.getStats(),
    },
    memory:  {
      rss:      Math.round(process.memoryUsage().rss / 1024 / 1024) + 'MB',
      heapUsed: Math.round(process.memoryUsage().heapUsed / 1024 / 1024) + 'MB',
    },
  });
});

export default router;
