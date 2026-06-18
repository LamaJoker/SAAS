/**
 * emailService.js — Envoi ponctuel d'un email de démo (route /resend).
 *
 * La SÉLECTION de la variante (cadence, relances) appartient à ce service ;
 * le RENDU appartient à src/email/render.js — source de vérité unique des
 * templates, partagée avec sequenceService.
 */
import { smtpPool }         from './smtpPool.js';
import { createTrackingPixel, wrapLink } from './trackingService.js';
import { countEmailsForSite, lastEmailDaysAgo, isEmailBlacklisted, recordEmailSent, sitesForEmailQueue } from '../db/queries.js';
import { logger }           from '../utils/logger.js';
import { randomBytes }      from 'crypto';
import { config }           from '../config/config.js';
import { buildUnsubToken }  from '../utils/unsubToken.js';
import { VARIANT_IDS, getVariant } from '../email/index.js';
import { renderEmail }      from '../email/render.js';

const SENDER_NAMES = ['Alex', 'Marc', 'Thomas', 'Julie', 'Sarah'];

function pickSender() {
  return SENDER_NAMES[Math.floor(Math.random() * SENDER_NAMES.length)];
}

/**
 * Cadence : premier envoi = variante A/B au hasard parmi les 5 ;
 * relance 1 = relance_soft, relance 2 = relance_directe ; stop après 3.
 */
function pickVariantId(emailsSent, daysSinceLast, followUpDays = 3) {
  if (emailsSent === 0) {
    return VARIANT_IDS[Math.floor(Math.random() * VARIANT_IDS.length)];
  }
  if (emailsSent >= 3 || daysSinceLast < followUpDays) return null;
  return emailsSent === 1 ? 'relance_soft' : 'relance_directe';
}

export async function sendDemoEmail({ lead, site, forceVariantId = null, followUpDays = 3 }) {
  if (!smtpPool.isConfigured) {
    logger.warn('[EmailService] SMTP non configuré — email ignoré', { leadId: lead.id });
    return { skipped: true, reason: 'smtp_not_configured' };
  }

  if (!lead.email) return { skipped: true, reason: 'no_email' };

  if (await isEmailBlacklisted(lead.email)) {
    return { skipped: true, reason: 'blacklisted' };
  }

  const emailsSent    = await countEmailsForSite(site.id);
  const daysSinceLast = await lastEmailDaysAgo(site.id);
  const isFollowup    = emailsSent > 0;

  const variantId = forceVariantId && getVariant(forceVariantId)
    ? forceVariantId
    : pickVariantId(emailsSent, daysSinceLast, followUpDays);

  if (!variantId) {
    return { skipped: true, reason: 'sequence_complete_or_too_soon' };
  }

  const sender = pickSender();
  const sendId = randomBytes(8).toString('hex');

  const { token, pixelUrl } = createTrackingPixel({ siteId: site.id, leadId: lead.id, variant: variantId });
  const trackedUrl = wrapLink({ url: site.url, token, label: 'cta' });

  const { subject, text, html } = renderEmail(variantId, {
    name: lead.name, city: lead.city, sender,
    url: site.url, trackedUrl, pixelUrl,
    toEmail: lead.email,
  });

  const result = await smtpPool.send({
    to: lead.email, subject, text, html,
    headers: {
      'X-Variant':        variantId,
      'X-Entity-ID':      lead.id,
      'X-Send-ID':        sendId,
      'Precedence':       'bulk',
      'List-Unsubscribe': `<${config.server.baseUrl}/unsubscribe/${buildUnsubToken(lead.email)}>`,
    },
  });

  await recordEmailSent({
    siteId:    site.id,
    leadId:    lead.id,
    variantId,
    messageId: result.messageId,
    isFollowup,
  });

  logger.info('[EmailService] Email envoyé', {
    leadId:    lead.id,
    variant:   variantId,
    isFollowup,
    messageId: result.messageId,
  });

  return { sent: true, variant: variantId, messageId: result.messageId, isFollowup };
}

export async function processEmailQueue(userId, { followUpDays = 3, limit = 50 } = {}) {
  const sites = await sitesForEmailQueue(userId, limit);

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
