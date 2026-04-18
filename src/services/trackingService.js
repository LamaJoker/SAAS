import { getDb }       from '../db/database.js';
import { config }      from '../config/config.js';
import { createHash, randomBytes } from 'crypto';

function generateToken(siteId, variant) {
  const raw = `${siteId}:${variant}:${randomBytes(8).toString('hex')}`;
  return createHash('sha256').update(raw).digest('hex').slice(0, 32);
}

export function createTrackingPixel({ siteId, leadId, variant }) {
  const db    = getDb();
  const token = generateToken(siteId, variant);
  const id    = randomBytes(8).toString('hex');

  db.exec(`
    CREATE TABLE IF NOT EXISTS email_events (
      id TEXT PRIMARY KEY, token TEXT NOT NULL UNIQUE,
      site_id TEXT, lead_id TEXT, variant TEXT, event_type TEXT NOT NULL,
      url TEXT, ip TEXT, user_agent TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_ee_token ON email_events(token);
  `);

  db.prepare(`
    INSERT OR IGNORE INTO email_events (id, token, site_id, lead_id, variant, event_type)
    VALUES (?, ?, ?, ?, ?, 'sent')
  `).run(id, token, siteId, leadId, variant);

  const pixelUrl  = `${config.server.baseUrl}/track/open/${token}`;
  const pixelHtml = `<img src="${pixelUrl}" width="1" height="1" style="display:none" alt="" />`;

  return { token, pixelUrl, pixelHtml };
}

export function wrapLink({ url, token, label = 'cta' }) {
  const db         = getDb();
  const clickToken = `${token}_click_${label}`;

  try {
    const parent = db.prepare(
      'SELECT site_id, lead_id, variant FROM email_events WHERE token = ? LIMIT 1'
    ).get(token);

    if (parent) {
      db.prepare(`
        INSERT OR IGNORE INTO email_events (id, token, site_id, lead_id, variant, event_type, url)
        VALUES (?, ?, ?, ?, ?, 'click_registered', ?)
      `).run(randomBytes(8).toString('hex'), clickToken, parent.site_id, parent.lead_id, parent.variant, url);
    }
  } catch {}

  return `${config.server.baseUrl}/track/click/${clickToken}`;
}
