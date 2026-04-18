import express from 'express';
import { getDb }  from '../../db/database.js';
import { logger } from '../../utils/logger.js';
import { randomBytes } from 'crypto';

const router = express.Router();

const PIXEL_GIF = Buffer.from(
  'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7',
  'base64'
);

const BOT_RE = /bot|crawler|spider|preview|prefetch|slack|telegram|whatsapp|facebook/i;

router.get('/open/:token', (req, res) => {
  res.set({
    'Content-Type':   'image/gif',
    'Cache-Control':  'no-cache, no-store, must-revalidate',
    'Pragma':         'no-cache',
    'Expires':        '0',
  });
  res.end(PIXEL_GIF);

  setImmediate(() => {
    try {
      const ua = req.headers['user-agent'] || '';
      if (BOT_RE.test(ua)) return;

      const db     = getDb();
      const token  = req.params.token;
      const ip     = req.headers['x-forwarded-for']?.split(',')[0] || req.ip;
      const parent = db.prepare('SELECT site_id, lead_id, variant FROM email_events WHERE token = ? LIMIT 1').get(token);
      if (!parent) return;

      const recent = db.prepare(`
        SELECT id FROM email_events
        WHERE token = ? AND event_type = 'open' AND ip = ?
          AND created_at >= datetime('now', '-5 minutes') LIMIT 1
      `).get(token, ip);
      if (recent) return;

      db.prepare(`
        INSERT INTO email_events (id, token, site_id, lead_id, variant, event_type, ip, user_agent)
        VALUES (?,?,?,?,?,'open',?,?)
      `).run(randomBytes(8).toString('hex'), `${token}_open_${Date.now()}`, parent.site_id, parent.lead_id, parent.variant, ip, ua);
    } catch (err) {
      logger.error('[Tracking] Open error', { error: err.message });
    }
  });
});

router.get('/click/:clickToken', (req, res) => {
  const { clickToken } = req.params;
  const ip = req.headers['x-forwarded-for']?.split(',')[0] || req.ip;
  const ua = req.headers['user-agent'] || '';

  const db = getDb();
  const registered = db.prepare(
    "SELECT site_id, lead_id, variant, url FROM email_events WHERE token = ? AND event_type = 'click_registered' LIMIT 1"
  ).get(clickToken);

  if (!registered?.url) {
    return res.redirect(302, process.env.BASE_URL || 'http://localhost:3000');
  }

  setImmediate(() => {
    try {
      db.prepare(`
        INSERT INTO email_events (id, token, site_id, lead_id, variant, event_type, url, ip, user_agent)
        VALUES (?,?,?,?,?,'click',?,?,?)
      `).run(
        randomBytes(8).toString('hex'),
        `${clickToken}_click_${Date.now()}`,
        registered.site_id,
        registered.lead_id,
        registered.variant,
        registered.url,
        ip,
        ua
      );
    } catch (err) {
      logger.error('[Tracking] Click error', { error: err.message });
    }
  });

  res.redirect(302, registered.url);
});

router.get('/stats', async (req, res, next) => {
  try {
    const days = Math.min(90, parseInt(req.query.days || '30'));
    const db   = getDb();

    const summary = db.prepare(`
      SELECT
        SUM(event_type = 'sent')  as sent,
        SUM(event_type = 'open')  as opens,
        SUM(event_type = 'click') as clicks
      FROM email_events
      WHERE created_at >= datetime('now', '-${days} days')
    `).get();

    const byVariant = db.prepare(`
      SELECT variant,
             SUM(event_type = 'sent')  as sent,
             SUM(event_type = 'open')  as opens,
             SUM(event_type = 'click') as clicks
      FROM email_events
      WHERE created_at >= datetime('now', '-${days} days') AND variant IS NOT NULL
      GROUP BY variant ORDER BY opens DESC
    `).all();

    const sent = summary.sent || 0;
    res.json({
      success: true,
      data: {
        period_days:  days,
        sent,
        opens:        summary.opens   || 0,
        clicks:       summary.clicks  || 0,
        open_rate:    sent > 0 ? Math.round((summary.opens  / sent) * 10000) / 100 : 0,
        click_rate:   sent > 0 ? Math.round((summary.clicks / sent) * 10000) / 100 : 0,
        by_variant:   byVariant,
      },
    });
  } catch (err) {
    next(err);
  }
});

export default router;
