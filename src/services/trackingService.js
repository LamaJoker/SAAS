/**
 * trackingService.js — Tracking ouvertures (pixel) + clics
 *
 * Génère :
 *   - Un pixel 1x1 transparent → /track/open/:token
 *   - Des URLs de tracking pour chaque lien → /track/click/:token
 *
 * Stocké en SQLite, consommé par le dashboard analytics.
 */

import { getDb }  from '../db/database.js';
import { config } from '../config/config.js';
import { createHash, randomBytes } from 'crypto';

// ─── Schema ───────────────────────────────────────────────────────────────────
export function ensureTrackingSchema() {
  getDb().exec(`
    CREATE TABLE IF NOT EXISTS email_events (
      id          TEXT PRIMARY KEY,
      token       TEXT NOT NULL UNIQUE,
      site_id     TEXT,
      lead_id     TEXT,
      variant     TEXT,
      event_type  TEXT NOT NULL,  -- 'sent' | 'open' | 'click'
      url         TEXT,           -- pour les clicks
      ip          TEXT,
      user_agent  TEXT,
      created_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_ee_token    ON email_events(token);
    CREATE INDEX IF NOT EXISTS idx_ee_lead     ON email_events(lead_id);
    CREATE INDEX IF NOT EXISTS idx_ee_type     ON email_events(event_type);
    CREATE INDEX IF NOT EXISTS idx_ee_site     ON email_events(site_id);
    CREATE INDEX IF NOT EXISTS idx_ee_created  ON email_events(created_at);
  `);
}

// ─── Token generation ─────────────────────────────────────────────────────────
function generateToken(siteId, variant, suffix = '') {
  const raw = `${siteId}:${variant}:${suffix}:${randomBytes(8).toString('hex')}`;
  return createHash('sha256').update(raw).digest('hex').slice(0, 32);
}

// ─── Record event ─────────────────────────────────────────────────────────────
export function recordEvent({ token, eventType, url = null, ip = null, userAgent = null }) {
  const db = getDb();
  const existing = db.prepare('SELECT site_id, lead_id, variant FROM email_events WHERE token = ? LIMIT 1').get(token);
  if (!existing) return null;

  const id = randomBytes(8).toString('hex');
  db.prepare(`
    INSERT INTO email_events (id, token, site_id, lead_id, variant, event_type, url, ip, user_agent)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, token + '_' + eventType + '_' + Date.now(), existing.site_id, existing.lead_id, existing.variant, eventType, url, ip, userAgent);

  return existing;
}

// ─── Pixel tracker ────────────────────────────────────────────────────────────
/**
 * Crée un enregistrement "sent" et retourne l'URL du pixel.
 */
export function createTrackingPixel({ siteId, leadId, variant }) {
  const token = generateToken(siteId, variant, 'open');
  const db    = getDb();
  const id    = randomBytes(8).toString('hex');

  db.prepare(`
    INSERT OR IGNORE INTO email_events (id, token, site_id, lead_id, variant, event_type)
    VALUES (?, ?, ?, ?, ?, 'sent')
  `).run(id, token, siteId, leadId, variant);

  const pixelUrl = `${config.server.baseUrl}/track/open/${token}`;
  const pixelHtml = `<img src="${pixelUrl}" width="1" height="1" style="display:none" alt="" />`;

  return { token, pixelUrl, pixelHtml };
}

/**
 * Wrappe une URL dans une URL de tracking.
 */
export function wrapLink({ url, token, label = 'cta' }) {
  const clickToken = token + '_click_' + label;
  const db = getDb();

  // Enregistrer le lien trackable
  try {
    const parent = db.prepare('SELECT site_id, lead_id, variant FROM email_events WHERE token = ? LIMIT 1').get(token);
    if (parent) {
      const id = randomBytes(8).toString('hex');
      db.prepare(`
        INSERT OR IGNORE INTO email_events (id, token, site_id, lead_id, variant, event_type, url)
        VALUES (?, ?, ?, ?, ?, 'click_registered', ?)
      `).run(id, clickToken, parent.site_id, parent.lead_id, parent.variant, url);
    }
  } catch {}

  return `${config.server.baseUrl}/track/click/${clickToken}`;
}

// ─── Analytics ────────────────────────────────────────────────────────────────
export function getEmailAnalytics({ days = 30 } = {}) {
  const db = getDb();

  const sent = db.prepare(`
    SELECT COUNT(DISTINCT lead_id) as n
    FROM email_events
    WHERE event_type = 'sent'
      AND created_at >= datetime('now', '-${days} days')
  `).get()?.n || 0;

  const opened = db.prepare(`
    SELECT COUNT(DISTINCT lead_id) as n
    FROM email_events
    WHERE event_type = 'open'
      AND created_at >= datetime('now', '-${days} days')
  `).get()?.n || 0;

  const clicked = db.prepare(`
    SELECT COUNT(DISTINCT lead_id) as n
    FROM email_events
    WHERE event_type = 'click'
      AND created_at >= datetime('now', '-${days} days')
  `).get()?.n || 0;

  const byVariant = db.prepare(`
    SELECT variant,
           SUM(event_type = 'sent')  as sent,
           SUM(event_type = 'open')  as opens,
           SUM(event_type = 'click') as clicks
    FROM email_events
    WHERE created_at >= datetime('now', '-${days} days')
    GROUP BY variant
    ORDER BY opens DESC
  `).all();

  const openRate  = sent > 0 ? Math.round((opened / sent) * 10000) / 100 : 0;
  const clickRate = sent > 0 ? Math.round((clicked / sent) * 10000) / 100 : 0;

  return {
    period_days: days,
    sent,
    opened,
    clicked,
    open_rate:   openRate,
    click_rate:  clickRate,
    by_variant:  byVariant,
  };
}
