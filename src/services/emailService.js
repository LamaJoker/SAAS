import { smtpPool }         from './smtpPool.js';
import { createTrackingPixel, wrapLink } from './trackingService.js';
import { getDb }            from '../db/database.js';
import { logger }           from '../utils/logger.js';
import { randomBytes }      from 'crypto';
import { config }           from '../config/config.js';

const SENDER_NAMES = ['Alex', 'Marc', 'Thomas', 'Julie', 'Sarah'];

function pickSender() {
  return SENDER_NAMES[Math.floor(Math.random() * SENDER_NAMES.length)];
}

function buildUnsubFooter(email) {
  const from    = process.env.SMTP_FROM || process.env.SMTP_USER || '';
  const token   = Buffer.from(email).toString('base64url');
  const unsubUrl = `${config.server.baseUrl}/unsubscribe/${token}`;
  return `<p style="margin-top:24px;font-size:11px;color:#aaa">
    <a href="${unsubUrl}" style="color:#aaa">Se désabonner</a> ·
    <a href="mailto:${from}?subject=Désabonnement" style="color:#aaa">Par email</a>
  </p>`;
}

function countEmailsForSite(siteId) {
  const row = getDb().prepare(
    'SELECT COUNT(*) as n FROM email_sends WHERE site_id = ?'
  ).get(siteId);
  return row?.n ?? 0;
}

function getDaysSinceLastEmail(siteId) {
  const row = getDb().prepare(
    'SELECT created_at FROM email_sends WHERE site_id = ? ORDER BY created_at DESC LIMIT 1'
  ).get(siteId);
  if (!row) return Infinity;
  return (Date.now() - new Date(row.created_at).getTime()) / 86_400_000;
}

function isEmailBlacklisted(email) {
  const row = getDb().prepare(
    'SELECT 1 FROM email_blacklist WHERE email = ?'
  ).get(email.toLowerCase());
  return !!row;
}

function recordEmailSent({ siteId, leadId, variantId, messageId, isFollowup = false }) {
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS email_sends (
      id TEXT PRIMARY KEY, site_id TEXT NOT NULL, lead_id TEXT NOT NULL,
      variant_id TEXT NOT NULL, message_id TEXT NOT NULL,
      is_followup INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_es_site ON email_sends(site_id);
  `);
  db.prepare(
    'INSERT INTO email_sends (id, site_id, lead_id, variant_id, message_id, is_followup) VALUES (?,?,?,?,?,?)'
  ).run(randomBytes(8).toString('hex'), siteId, leadId, variantId, messageId, isFollowup ? 1 : 0);
}

const VARIANTS = {
  curiosite: {
    id: 'curiosite',
    subject: ({ name }) => `J'ai fait quelque chose pour ${name}`,
    text: ({ name, city, trackedUrl, sender }) =>
`Bonjour,

J'ai créé quelque chose pour vous : ${trackedUrl}

C'est un site pour ${name} à ${city}. Regardez vite.

Si ça vous intéresse, répondez-moi.

${sender}`,
    html: ({ name, city, trackedUrl, sender, pixelHtml, unsubFooter }) => `
<div style="font-family:Arial,sans-serif;font-size:14px;color:#222;max-width:520px;line-height:1.7">
  <p>Bonjour,</p>
  <p>J'ai créé quelque chose pour vous :</p>
  <p style="margin:20px 0">
    <a href="${trackedUrl}" style="background:#6366f1;color:#fff;padding:12px 26px;border-radius:6px;text-decoration:none;font-weight:bold;display:inline-block">→ Voir ma démo</a>
  </p>
  <p>C'est un site pour <strong>${name}</strong> à ${city}.</p>
  <p>Si ça vous intéresse, répondez-moi.<br><br>${sender}</p>
  ${unsubFooter}${pixelHtml}
</div>`,
  },
  direct: {
    id: 'direct',
    subject: ({ city }) => `Votre site à ${city} — démo gratuite`,
    text: ({ name, trackedUrl, sender }) =>
`Bonjour,

Site démo pour ${name} : ${trackedUrl}

Gratuit. Prêt. Regardez.

${sender}`,
    html: ({ name, trackedUrl, sender, pixelHtml, unsubFooter }) => `
<div style="font-family:Arial,sans-serif;font-size:14px;color:#222;max-width:520px;line-height:1.7">
  <p>Bonjour,</p>
  <p>Site démo pour <strong>${name}</strong> :</p>
  <p style="margin:20px 0">
    <a href="${trackedUrl}" style="background:#111;color:#fff;padding:12px 26px;border-radius:6px;text-decoration:none;font-weight:bold;display:inline-block">Voir →</a>
  </p>
  <p>Gratuit. Prêt. Regardez.</p>
  <p>${sender}</p>
  ${unsubFooter}${pixelHtml}
</div>`,
  },
  relance_soft: {
    id: 'relance_soft',
    subject: ({ name }) => `Re: ${name}`,
    text: ({ trackedUrl, sender }) =>
`Bonjour,

Je me permets de revenir vers vous.

La démo est toujours disponible : ${trackedUrl}

Si ce n'est pas le bon moment, dites-le moi.

${sender}`,
    html: ({ trackedUrl, sender, pixelHtml, unsubFooter }) => `
<div style="font-family:Arial,sans-serif;font-size:14px;color:#222;max-width:520px;line-height:1.7">
  <p>Bonjour,</p>
  <p>Je me permets de revenir vers vous.</p>
  <p style="margin:16px 0">
    <a href="${trackedUrl}" style="color:#6366f1;font-weight:bold">La démo est toujours disponible →</a>
  </p>
  <p>Si ce n'est pas le bon moment, dites-le moi.</p>
  <p>${sender}</p>
  ${unsubFooter}${pixelHtml}
</div>`,
  },
  relance_directe: {
    id: 'relance_directe',
    subject: ({ name }) => `Dernier message — ${name}`,
    text: ({ name, trackedUrl, sender }) =>
`Bonjour,

C'est mon dernier message.

J'avais créé ce site pour ${name} : ${trackedUrl}

Si vous le voulez, répondez. Sinon, bonne continuation.

${sender}`,
    html: ({ name, trackedUrl, sender, pixelHtml, unsubFooter }) => `
<div style="font-family:Arial,sans-serif;font-size:14px;color:#222;max-width:520px;line-height:1.7">
  <p>Bonjour,</p>
  <p>C'est mon dernier message.</p>
  <p>J'avais créé ce site pour <strong>${name}</strong> :</p>
  <p style="margin:16px 0">
    <a href="${trackedUrl}" style="background:#ef4444;color:#fff;padding:12px 26px;border-radius:6px;text-decoration:none;font-weight:bold;display:inline-block">Voir la démo →</a>
  </p>
  <p>Si vous le voulez, répondez. Sinon, bonne continuation.</p>
  <p>${sender}</p>
  ${unsubFooter}${pixelHtml}
</div>`,
  },
};

const VARIANT_KEYS = ['curiosite', 'direct'];

function pickVariant(emailsSent, daysSinceLast, followUpDays = 3) {
  if (emailsSent === 0) {
    return VARIANTS[VARIANT_KEYS[Math.floor(Math.random() * VARIANT_KEYS.length)]];
  }
  if (emailsSent >= 3 || daysSinceLast < followUpDays) return null;
  if (emailsSent === 1) return VARIANTS.relance_soft;
  if (emailsSent === 2) return VARIANTS.relance_directe;
  return null;
}

export async function sendDemoEmail({ lead, site, forceVariantId = null, followUpDays = 3 }) {
  if (!smtpPool.isConfigured) {
    logger.warn('[EmailService] SMTP non configuré — email ignoré', { leadId: lead.id });
    return { skipped: true, reason: 'smtp_not_configured' };
  }

  if (!lead.email) return { skipped: true, reason: 'no_email' };

  if (isEmailBlacklisted(lead.email)) {
    return { skipped: true, reason: 'blacklisted' };
  }

  const emailsSent    = countEmailsForSite(site.id);
  const daysSinceLast = getDaysSinceLastEmail(site.id);
  const isFollowup    = emailsSent > 0;

  const variant = forceVariantId
    ? VARIANTS[forceVariantId]
    : pickVariant(emailsSent, daysSinceLast, followUpDays);

  if (!variant) {
    return { skipped: true, reason: 'sequence_complete_or_too_soon' };
  }

  const sender  = pickSender();
  const sendId  = randomBytes(8).toString('hex');

  const { pixelHtml, token } = createTrackingPixel({ siteId: site.id, leadId: lead.id, variant: variant.id });
  const trackedUrl = wrapLink({ url: site.url, token, label: 'cta' });
  const unsubFooter = buildUnsubFooter(lead.email);

  const ctx = { name: lead.name, city: lead.city, trackedUrl, sender, pixelHtml, unsubFooter };

  const result = await smtpPool.send({
    to:      lead.email,
    subject: variant.subject(ctx),
    text:    variant.text(ctx),
    html:    variant.html(ctx),
    headers: {
      'X-Variant':       variant.id,
      'X-Entity-ID':     lead.id,
      'X-Send-ID':       sendId,
      'Precedence':      'bulk',
      'List-Unsubscribe': `<${config.server.baseUrl}/unsubscribe/${Buffer.from(lead.email).toString('base64url')}>`,
    },
  });

  recordEmailSent({
    siteId:    site.id,
    leadId:    lead.id,
    variantId: variant.id,
    messageId: result.messageId,
    isFollowup,
  });

  logger.info('[EmailService] Email envoyé', {
    leadId:    lead.id,
    variant:   variant.id,
    isFollowup,
    messageId: result.messageId,
  });

  return { sent: true, variant: variant.id, messageId: result.messageId, isFollowup };
}

export async function processEmailQueue(userId, { followUpDays = 3, limit = 50 } = {}) {
  const db = getDb();

  const sites = db.prepare(`
    SELECT s.*, l.name as lead_name, l.city, l.email as lead_email, l.phone as lead_phone,
           l.id as lead_db_id
    FROM sites s
    JOIN leads l ON l.id = s.lead_id
    WHERE s.user_id = ? AND l.email IS NOT NULL
    ORDER BY s.created_at DESC
    LIMIT ?
  `).all(userId, limit);

  const stats = { sent: 0, skipped: 0, errors: 0 };

  for (const row of sites) {
    const lead = { id: row.lead_db_id, name: row.lead_name, city: row.city, email: row.lead_email };
    const site = { id: row.id, url: row.url };

    try {
      const result = await sendDemoEmail({ lead, site, followUpDays });
      if (result.sent) stats.sent++;
      else stats.skipped++;
    } catch (err) {
      logger.error('[EmailService] Erreur envoi', { leadId: lead.id, error: err.message });
      stats.errors++;
    }

    await new Promise(r => setTimeout(r, 2000 + Math.random() * 1000));
  }

  return stats;
}
