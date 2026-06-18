import { getDb }       from '../db/database.js';
import { config }      from '../config/config.js';
import { createHash, randomBytes } from 'crypto';

function generateToken(siteId, variant) {
  const raw = `${siteId}:${variant}:${randomBytes(8).toString('hex')}`;
  return createHash('sha256').update(raw).digest('hex').slice(0, 32);
}

// La table email_events est créée par la migration v3 (database.js).
// Aucun DDL ici : c'est un hot-path appelé à chaque email envoyé.
export function createTrackingPixel({ siteId, leadId, variant }) {
  const db    = getDb();
  const token = generateToken(siteId, variant);
  const id    = randomBytes(8).toString('hex');

  db.prepare(`
    INSERT OR IGNORE INTO email_events (id, token, site_id, lead_id, variant, event_type)
    VALUES (?, ?, ?, ?, ?, 'sent')
  `).run(id, token, siteId, leadId, variant);

  const pixelUrl  = `${config.server.baseUrl}/track/open/${token}`;
  const pixelHtml = `<img src="${pixelUrl}" width="1" height="1" style="display:none" alt="" />`;

  return { token, pixelUrl, pixelHtml };
}

// Apple Mail Privacy Protection (et proxys) pré-chargent les images dès la
// réception → "ouverture" quasi instantanée et UA proxy. Heuristique : une
// ouverture survenant moins de `prefetchSeconds` après l'envoi, ou via un UA
// de proxy connu, est une ouverture machine (à exclure du taux humain).
const MACHINE_UA_RE = /GoogleImageProxy|YahooMailProxy|Barracuda|Proofpoint|Mimecast/i;

export function isMachineOpen({ sentAt, openAt = Date.now(), prefetchSeconds = 10, userAgent = '' }) {
  if (MACHINE_UA_RE.test(userAgent)) return true;
  if (!sentAt) return false;
  const deltaSec = (new Date(openAt).getTime() - new Date(sentAt).getTime()) / 1000;
  return deltaSec >= 0 && deltaSec < prefetchSeconds;
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
