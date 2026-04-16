/**
 * routes/tracking.js — Tracking email opens & clicks
 *
 * GET /track/open/:token.gif  → pixel 1x1 transparent, enregistre l'ouverture
 * GET /track/click/:token     → redirect vers URL cible, enregistre le clic
 *
 * Intégrer dans src/api/index.js :
 *   import trackingRouter from './routes/tracking.js';
 *   app.use('/track', trackingRouter);
 */

import express from 'express';
import { getDb } from '../../db/database.js';
import { logger } from '../../utils/logger.js';

const router = express.Router();

// Pixel GIF 1x1 transparent (bytes réels — pas de dépendance externe)
const PIXEL = Buffer.from(
  'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7',
  'base64'
);

function decodeToken(token) {
  try {
    return Buffer.from(token.replace(/\.gif$/, ''), 'base64url').toString('utf-8');
  } catch {
    return null;
  }
}

function updateSendField(db, sendId, field) {
  const now = new Date().toISOString();
  const changes = db.prepare(`
    UPDATE email_sends SET ${field} = ? WHERE id = ? AND ${field} IS NULL
  `).run(now, sendId).changes;

  if (changes > 0) {
    // Incrémenter stats variante
    const row = db.prepare('SELECT variant_id FROM email_sends WHERE id = ?').get(sendId);
    if (row && field === 'opened_at') {
      db.prepare(`
        INSERT INTO variant_stats (variant_id, opens) VALUES (?, 1)
        ON CONFLICT(variant_id) DO UPDATE SET opens = opens + 1, updated_at = datetime('now')
      `).run(row.variant_id);
    }
    if (row && field === 'clicked_at') {
      db.prepare(`
        INSERT INTO variant_stats (variant_id, clicks) VALUES (?, 1)
        ON CONFLICT(variant_id) DO UPDATE SET clicks = clicks + 1, updated_at = datetime('now')
      `).run(row.variant_id);
    }
  }
  return changes > 0;
}

function flagHotLead(db, sendId) {
  // Si ouverture ET clic → lead chaud → mettre à jour le lead
  const send = db.prepare(`
    SELECT site_id, opened_at, clicked_at FROM email_sends WHERE id = ?
  `).get(sendId);

  if (!send || !send.opened_at || !send.clicked_at) return;

  // Récupérer le lead_id via le site
  const site = db.prepare('SELECT lead_id FROM sites WHERE id = ?').get(send.site_id);
  if (!site) return;

  // Marquer le lead comme "chaud" (ajouter colonne si besoin)
  try {
    db.prepare(`UPDATE leads SET status = 'hot' WHERE id = ? AND status = 'done'`).run(site.lead_id);
    logger.info('[Tracking] Hot lead flagged', { leadId: site.lead_id, sendId });
  } catch {
    // Colonne hot peut ne pas exister selon schema — non bloquant
  }
}

// ── GET /track/open/:token(.gif) ──────────────────────────────────────────────

router.get('/open/:token', (req, res) => {
  // Toujours répondre avec le pixel, même en cas d'erreur
  res.setHeader('Content-Type', 'image/gif');
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.end(PIXEL);

  // Traitement asynchrone (ne bloque pas la réponse)
  const sendId = decodeToken(req.params.token);
  if (!sendId) return;

  try {
    const db = getDb();
    const updated = updateSendField(db, sendId, 'opened_at');
    if (updated) {
      logger.info('[Tracking] Open recorded', {
        sendId,
        ip: req.ip,
        ua: req.get('user-agent')?.slice(0, 100),
      });
      flagHotLead(db, sendId);
    }
  } catch (err) {
    logger.error('[Tracking] Open error', { error: err.message, sendId });
  }
});

// ── GET /track/click/:token ────────────────────────────────────────────────────

router.get('/click/:token', (req, res) => {
  const sendId    = decodeToken(req.params.token);
  const targetUrl = req.query.url;

  // Validation URL cible
  let safeUrl = targetUrl;
  try {
    const parsed = new URL(targetUrl);
    // Whitelist domaines autorisés (évite SSRF / open redirect)
    const allowed = process.env.ALLOWED_REDIRECT_DOMAINS?.split(',') || [];
    const baseHost = new URL(process.env.BASE_URL || 'http://localhost:3000').hostname;
    allowed.push(baseHost);
    if (!allowed.some(d => parsed.hostname === d || parsed.hostname.endsWith('.' + d))) {
      logger.warn('[Tracking] Redirect blocked (domain not allowed)', { targetUrl, sendId });
      return res.redirect(302, process.env.BASE_URL || '/');
    }
  } catch {
    safeUrl = process.env.BASE_URL || '/';
  }

  res.redirect(302, safeUrl);

  // Tracking asynchrone
  if (!sendId) return;

  try {
    const db      = getDb();
    const updated = updateSendField(db, sendId, 'clicked_at');
    if (updated) {
      logger.info('[Tracking] Click recorded', {
        sendId,
        ip: req.ip,
        ua: req.get('user-agent')?.slice(0, 100),
        targetUrl: safeUrl,
      });
      flagHotLead(db, sendId);
    }
  } catch (err) {
    logger.error('[Tracking] Click error', { error: err.message, sendId });
  }
});

// ── GET /track/stats (interne, protégé par auth) ──────────────────────────────

router.get('/stats', (req, res, next) => {
  try {
    const db = getDb();

    const overall = db.prepare(`
      SELECT
        COUNT(*)           AS total_sent,
        COUNT(opened_at)   AS total_opens,
        COUNT(clicked_at)  AS total_clicks,
        ROUND(COUNT(opened_at)  * 100.0 / COUNT(*), 1) AS open_rate,
        ROUND(COUNT(clicked_at) * 100.0 / COUNT(*), 1) AS click_rate
      FROM email_sends
    `).get();

    const byVariant = db.prepare(`
      SELECT
        variant_id,
        COUNT(*)           AS sends,
        COUNT(opened_at)   AS opens,
        COUNT(clicked_at)  AS clicks,
        ROUND(COUNT(opened_at)  * 100.0 / COUNT(*), 1) AS open_rate,
        ROUND(COUNT(clicked_at) * 100.0 / COUNT(*), 1) AS click_rate
      FROM email_sends
      GROUP BY variant_id
      ORDER BY click_rate DESC
    `).all();

    const hotLeads = db.prepare(`
      SELECT
        s.lead_name, s.city, s.url, s.lead_email,
        e.created_at AS sent_at, e.opened_at, e.clicked_at, e.variant_id
      FROM email_sends e
      JOIN sites s ON s.id = e.site_id
      WHERE e.opened_at IS NOT NULL AND e.clicked_at IS NOT NULL
      ORDER BY e.clicked_at DESC
      LIMIT 20
    `).all();

    res.json({ success: true, data: { overall, byVariant, hotLeads } });
  } catch (err) {
    next(err);
  }
});

export default router;
