/**
 * emailService.js — Envoi ponctuel d'un email de démo (route /resend, worker email).
 *
 * La SÉLECTION de la variante (cadence, relances) appartient à ce service ;
 * le RENDU appartient à src/email/render.js — source de vérité unique des
 * templates, partagée avec sequenceService.
 */
import { smtpPool }         from './smtpPool.js';
import { createTrackingPixel, wrapLink } from './trackingService.js';
import { countEmailsForSite, lastEmailDaysAgo, isEmailBlacklisted, recordEmailSent, activeSequenceForSite } from '../db/queries.js';
import { config }           from '../config/config.js';
import { logger }           from '../utils/logger.js';
import { randomBytes }      from 'crypto';
import { VARIANT_IDS, getVariant } from '../email/index.js';
import { renderEmail, unsubscribeHeaders } from '../email/render.js';

/** Plafond d'emails par prospect, toutes sources confondues (séquence + manuel). */
export const MAX_EMAILS_PER_SITE = 3;

/**
 * Cadence : premier envoi = variante A/B au hasard parmi les 5 ;
 * relance 1 = relance_soft, relance 2 = relance_directe.
 */
function pickVariantId(emailsSent) {
  if (emailsSent === 0) {
    return VARIANT_IDS[Math.floor(Math.random() * VARIANT_IDS.length)];
  }
  return emailsSent === 1 ? 'relance_soft' : 'relance_directe';
}

/**
 * Envoi ponctuel d'un email de démo (relance manuelle depuis le dashboard).
 *
 * `forceVariantId` choisit le TEXTE, jamais l'autorisation d'envoyer : avant,
 * le passer contournait le plafond de 3 emails et l'espacement minimal, ce qui
 * permettait de relancer un prospect sans limite.
 *
 * Une séquence automatique encore active bloque l'envoi manuel : les deux
 * partiraient à quelques heures d'écart et le prospect recevrait deux relances.
 */
export async function sendDemoEmail({ lead, site, forceVariantId = null, followUpDays = 3 }) {
  if (!smtpPool.isConfigured) {
    logger.warn('[EmailService] SMTP non configuré — email ignoré', { leadId: lead.id });
    return { skipped: true, reason: 'smtp_not_configured' };
  }

  if (!lead.email) return { skipped: true, reason: 'no_email' };

  if (await isEmailBlacklisted(lead.email)) {
    return { skipped: true, reason: 'blacklisted' };
  }

  const active = await activeSequenceForSite(site.id);
  if (active) {
    return { skipped: true, reason: 'sequence_active', nextSendAt: active.next_send_at };
  }

  const emailsSent = await countEmailsForSite(site.id);
  if (emailsSent >= MAX_EMAILS_PER_SITE) {
    return { skipped: true, reason: 'sequence_complete' };
  }
  const daysSinceLast = await lastEmailDaysAgo(site.id);
  if (daysSinceLast < followUpDays) {
    return { skipped: true, reason: 'too_soon', followUpDays };
  }

  const variantId = forceVariantId && getVariant(forceVariantId)
    ? forceVariantId
    : pickVariantId(emailsSent);
  const isFollowup = emailsSent > 0;
  const sender     = config.email.senderName;
  const sendId     = randomBytes(8).toString('hex');

  const { token, pixelUrl } = createTrackingPixel({ siteId: site.id, leadId: lead.id, variant: variantId });
  const trackedUrl = wrapLink({ url: site.url, token, label: 'cta' });

  const { subject, text, html } = renderEmail(variantId, {
    name: lead.name, city: lead.city, sender,
    url: site.url, trackedUrl, pixelUrl,
    toEmail: lead.email,
  });

  const result = await smtpPool.send({
    to: lead.email, subject, text, html, fromName: sender,
    headers: {
      'X-Variant':        variantId,
      'X-Entity-ID':      lead.id,
      'X-Send-ID':        sendId,
      'Precedence':       'bulk',
      ...unsubscribeHeaders(lead.email),
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
