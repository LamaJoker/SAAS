/**
 * routes/tracking.js — Endpoints de tracking email
 *
 * GET /track/open/:token  → Pixel 1x1, enregistre ouverture
 * GET /track/click/:token → Redirige vers URL cible, enregistre clic
 */

import express from 'express';
import { getDb } from '../../db/database.js';
import { logger } from '../../utils/logger.js';
import { randomBytes } from 'crypto';

const router = express.Router();

// Pixel GIF 1x1 transparent (base64)
const PIXEL_GIF = Buffer.from(
  'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7',
  'base64'
);

// ─── Open pixel ───────────────────────────────────────────────────────────────
router.get('/open/:token', (req, res) => {
  // Répondre immédiatement (ne pas bloquer sur l'écriture DB)
  res.set({
    'Content-Type':  'image/gif',
    'Cache-Control': 'no-cache, no-store, must-revalidate',
    'Pragma':        'no-cache',
    'Expires':       '0',
  });
  res.end(PIXEL_GIF);

  // Enregistrement asynchrone
  setImmediate(() => {
    try {
      const { token }   = req.params;
      const ip          = req.headers['x-forwarded-for']?.split(',')[0] || req.ip;
      const userAgent   = req.headers['user-agent'] || '';

      // Ignorer les bots connus
      if (/bot|crawler|spider|preview|prefetch/i.test(userAgent)) return;

      const db = getDb();
      const parent = db.prepare(
        'SELECT site_id, lead_id, variant FROM email_events WHERE token = ? LIMIT 1'
      ).get(token);

      if (!parent) return;

      // Déduplique : pas 2 ouvertures en moins de 5 minutes du même IP
      const recent = db.prepare(`
        SELECT id FROM email_events
        WHERE token = ? AND event_type = 'open' AND ip = ?
          AND created_at >= datetime('now', '-5 minutes')
        LIMIT 1
      `).get(token, ip);

      if (recent) return;

      const id = randomBytes(8).toString('hex');
      db.prepare(`
        INSERT INTO email_events (id, token, site_id, lead_id, variant, event_type, ip, user_agent)
        VALUES (?, ?, ?, ?, ?, 'open', ?, ?)
      `).run(id, token + '_open_' + Date.now(), parent.site_id, parent.lead_id, parent.variant, ip, userAgent);

      logger.debug(`[Tracking] Open: lead=${parent.lead_id} variant=${parent.variant}`);
    } catch (err) {
      logger.error('[Tracking] Open error:', err.message);
    }
  });
});

// ─── Click redirect ───────────────────────────────────────────────────────────
router.get('/click/:clickToken', (req, res) => {
  const { clickToken } = req.params;
  const ip             = req.headers['x-forwarded-for']?.split(',')[0] || req.ip;
  const userAgent      = req.headers['user-agent'] || '';

  const db = getDb();
  const registered = db.prepare(
    "SELECT site_id, lead_id, variant, url FROM email_events WHERE token = ? AND event_type = 'click_registered' LIMIT 1"
  ).get(clickToken);

  if (!registered?.url) {
    return res.redirect(302, process.env.BASE_URL || 'http://localhost:3000');
  }

  // Enregistrer le clic
  setImmediate(() => {
    try {
      const id = randomBytes(8).toString('hex');
      db.prepare(`
        INSERT INTO email_events (id, token, site_id, lead_id, variant, event_type, url, ip, user_agent)
        VALUES (?, ?, ?, ?, ?, 'click', ?, ?, ?)
      `).run(
        id,
        clickToken + '_click_' + Date.now(),
        registered.site_id,
        registered.lead_id,
        registered.variant,
        registered.url,
        ip,
        userAgent
      );
      logger.debug(`[Tracking] Click: lead=${registered.lead_id} variant=${registered.variant}`);
    } catch (err) {
      logger.error('[Tracking] Click error:', err.message);
    }
  });

  res.redirect(302, registered.url);
});

// ─── Analytics endpoint ───────────────────────────────────────────────────────
router.get('/stats', (req, res, next) => {
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
             SUM(event_type = 'click') as clicks,
             ROUND(100.0 * SUM(event_type = 'open')  / NULLIF(SUM(event_type = 'sent'), 0), 1) as open_rate,
             ROUND(100.0 * SUM(event_type = 'click') / NULLIF(SUM(event_type = 'sent'), 0), 1) as click_rate
      FROM email_events
      WHERE created_at >= datetime('now', '-${days} days')
        AND variant IS NOT NULL
      GROUP BY variant
      ORDER BY opens DESC
    `).all();

    res.json({
      success: true,
      data: {
        period_days: days,
        ...summary,
        open_rate:   summary.sent > 0 ? Math.round(summary.opens  / summary.sent * 10000) / 100 : 0,
        click_rate:  summary.sent > 0 ? Math.round(summary.clicks / summary.sent * 10000) / 100 : 0,
        by_variant:  byVariant,
      },
    });
  } catch (err) {
    next(err);
  }
});

export default router;
