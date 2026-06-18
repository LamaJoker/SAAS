/**
 * render.js — Façade de rendu unique pour tous les emails de prospection.
 *
 * Seul endroit qui construit le footer de désabonnement et normalise le
 * contexte (pixelUrl ↔ pixelHtml). emailService et sequenceService passent
 * tous les deux par ici : une seule source de vérité pour les templates.
 */
import { getVariant }      from './index.js';
import { buildUnsubToken } from '../utils/unsubToken.js';
import { config }          from '../config/config.js';

export function buildUnsubFooter(email) {
  const from = process.env.SMTP_FROM || process.env.SMTP_USER || '';
  const url  = `${config.server.baseUrl}/unsubscribe/${buildUnsubToken(email)}`;
  // Identité + adresse postale de l'expéditeur : obligation légale du cold email
  // (CAN-SPAM ; bonne pratique RGPD). Affichées si renseignées en config.
  const sender  = [config.legal.company, config.legal.address].filter(Boolean).join(' · ');
  const postal  = sender
    ? `<br><span style="color:#bbb">${sender}</span>`
    : '';
  return `<p style="margin-top:24px;font-size:11px;color:#999">
    <a href="${url}" style="color:#999">Se désabonner</a> ·
    <a href="mailto:${from}?subject=Désabonnement" style="color:#999">Par email</a>${postal}
  </p>`;
}

/**
 * @param {string} variantId  id d'une variante (premier contact ou relance)
 * @param {object} raw        contexte : { name, city, sender, trackedUrl, pixelUrl,
 *                            toEmail, url?, unsubFooter?, pixelHtml? }
 * @returns {{ subject, text, html, variantId }}
 */
export function renderEmail(variantId, raw) {
  const variant = getVariant(variantId);
  if (!variant) throw new Error(`Variante inconnue: ${variantId}`);

  const ctx = {
    ...raw,
    pixelHtml: raw.pixelHtml
      ?? `<img src="${raw.pixelUrl}" width="1" height="1" style="display:none" alt="" />`,
    unsubFooter: raw.unsubFooter ?? buildUnsubFooter(raw.toEmail),
  };

  return {
    subject:   variant.subject(ctx),
    text:      variant.text(ctx),
    html:      variant.html(ctx),
    variantId: variant.id,
  };
}
