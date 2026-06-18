import express from 'express';
import { resolveTxt } from 'dns/promises';
import { getDb }        from '../../db/database.js';
import { smtpPool }     from '../../services/smtpPool.js';
import { scrapeQueue, generateQueue, emailQueue } from '../../workers/index.js';
import { authenticate, requireAdmin } from '../middleware/auth.js';
import { config } from '../../config/config.js';

const router = express.Router();

function sendingDomain() {
  if (config.features.dkim.domain) return config.features.dkim.domain;
  const from = process.env.SMTP_FROM || process.env.SMTP_USER || '';
  return from.split('@')[1] || null;
}

async function txtContains(name, needle) {
  try {
    const records = await resolveTxt(name);
    return records.some(parts => parts.join('').toLowerCase().includes(needle));
  } catch {
    return false;
  }
}

function dbAlive() {
  try { getDb().prepare('SELECT 1').get(); return true; } catch { return false; }
}

/**
 * GET /health — liveness PUBLIC minimal.
 * Ne révèle aucune information d'infrastructure (queues, SMTP, mémoire) :
 * juste de quoi qu'un load balancer / uptime monitor sache si on répond.
 */
router.get('/', (req, res) => {
  const ok = dbAlive();
  res.status(ok ? 200 : 503).json({ status: ok ? 'ok' : 'degraded' });
});

/**
 * GET /health/details — diagnostic COMPLET, réservé aux admins.
 * Queues, SMTP, mémoire, alertes actionnables.
 */
router.get('/details', authenticate, requireAdmin, async (req, res) => {
  const dbOk = dbAlive();

  const smtpStats  = smtpPool.isConfigured ? smtpPool.getStats() : [];
  const smtpActive = smtpStats.filter(s => s.healthy).length;

  // getStats peut être asynchrone (driver BullMQ) → await uniforme
  const queues = {
    scrape:   await scrapeQueue.getStats(),
    generate: await generateQueue.getStats(),
    email:    await emailQueue.getStats(),
  };

  const alerts = [];
  if (!dbOk) alerts.push({ level: 'critical', msg: 'Base de données inaccessible' });
  for (const s of smtpStats) {
    if (s.inQuarantine) alerts.push({ level: 'warning', msg: `SMTP ${s.user} en quarantaine` });
    if (s.sent > 0 && s.bounced / s.sent > 0.05) {
      alerts.push({ level: 'critical', msg: `SMTP ${s.user} : taux de bounce ${Math.round((s.bounced / s.sent) * 100)}%` });
    }
  }
  if (smtpPool.isConfigured && smtpActive === 0) {
    alerts.push({ level: 'critical', msg: 'Aucun transporteur SMTP actif' });
  }
  for (const [name, st] of Object.entries(queues)) {
    if ((st.error ?? 0) > 5) alerts.push({ level: 'warning', msg: `Queue ${name} : ${st.error} jobs en erreur` });
  }

  res.json({
    status:  dbOk ? (alerts.some(a => a.level === 'critical') ? 'degraded' : 'ok') : 'degraded',
    alerts,
    uptime:  Math.round(process.uptime()),
    db:      dbOk ? 'connected' : 'error',
    smtp:    { configured: smtpPool.isConfigured, active: smtpActive, total: smtpStats.length },
    queues,
    memory:  {
      rss:      Math.round(process.memoryUsage().rss / 1024 / 1024) + 'MB',
      heapUsed: Math.round(process.memoryUsage().heapUsed / 1024 / 1024) + 'MB',
    },
  });
});

/**
 * GET /health/deliverability — vérifie SPF / DKIM / DMARC du domaine d'envoi.
 * Admin only. C'est LE prérequis du cold email : sans ces 3 enregistrements,
 * les messages partent en spam.
 */
router.get('/deliverability', authenticate, requireAdmin, async (req, res) => {
  const domain = sendingDomain();
  if (!domain) {
    return res.json({ success: true, data: { domain: null, configured: false,
      hint: 'Définissez DKIM_DOMAIN ou SMTP_FROM pour activer la vérification.' } });
  }
  const selector = config.features.dkim.selector;
  const [spf, dkim, dmarc] = await Promise.all([
    txtContains(domain, 'v=spf1'),
    txtContains(`${selector}._domainkey.${domain}`, 'p='),
    txtContains(`_dmarc.${domain}`, 'v=dmarc1'),
  ]);
  res.json({
    success: true,
    data: {
      domain, selector,
      spf, dkim, dmarc,
      dkim_signing_active: !!(config.features.dkim.domain && config.features.dkim.privateKey),
      all_green: spf && dkim && dmarc,
    },
  });
});

export default router;
