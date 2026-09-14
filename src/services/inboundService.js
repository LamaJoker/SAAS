/**
 * inboundService.js — Traitement des réponses email entrantes.
 *
 * Quand un prospect répond, la séquence froide DOIT s'arrêter (sinon il reçoit
 * « Dernier message » alors qu'il a déjà répondu) et le lead passe en
 * « rappeler ». Logique partagée par le webhook POST /inbound/:secret et le
 * poller IMAP optionnel.
 */
import { repo }     from '../db/repo.js';
import { findLeadsByEmail, recordInboundReply } from '../db/queries.js';
import { smtpPool } from './smtpPool.js';
import { sanitize } from '../utils/utils.js';
import { logger }   from '../utils/logger.js';
import { config }   from '../config/config.js';
import { parseBounce, handleBounce } from './bounceService.js';

/** Extrait l'adresse d'un champ "Nom <email@x.fr>" ou "email@x.fr". Testable. */
export function extractEmailAddress(from) {
  if (typeof from !== 'string') return null;
  const m = from.match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i);
  return m ? m[0].toLowerCase() : null;
}

async function notifyOwnerOfReply(owner, lead, subject, snippet) {
  if (!smtpPool.isConfigured || !owner?.email) return;
  try {
    await smtpPool.send({
      to: owner.email,
      subject: `💬 ${lead.name} a répondu`,
      text: `${lead.name} a répondu à votre séquence.\n\nObjet : ${subject || '—'}\n\n${snippet || ''}\n\nRappelez-le : ${config.server.baseUrl}/dashboard.html`,
      html: `
<div style="font-family:Arial,sans-serif;font-size:14px;color:#222;max-width:520px;line-height:1.6">
  <p style="font-size:16px"><strong>💬 ${sanitize(lead.name)} a répondu !</strong></p>
  ${subject ? `<p style="color:#555">Objet : ${sanitize(subject)}</p>` : ''}
  ${snippet ? `<p style="padding:12px;background:#f5f5f5;border-radius:6px">${sanitize(snippet)}</p>` : ''}
  <p>La séquence a été stoppée. <a href="${config.server.baseUrl}/dashboard.html" style="color:#2563eb">Ouvrir le dashboard →</a></p>
</div>`,
    });
  } catch (err) {
    logger.warn('[Inbound] Notif réponse échouée', { error: err.message });
  }
}

/**
 * Traite une réponse entrante : stoppe la séquence, passe les leads
 * correspondants en « rappeler », trace l'événement, notifie le propriétaire.
 * @returns {Promise<{ matched: number, bounce?: object }>}
 */
export async function handleInboundEmail({ from, subject = '', text = '' }) {
  // Un rapport de non-remise n'est pas une réponse : il vient de MAILER-DAEMON,
  // ne correspond à aucun lead, et était jusqu'ici simplement ignoré — l'adresse
  // morte restait sollicitée à chaque relance.
  const bounce = parseBounce({ from, subject, text });
  if (bounce.isBounce) {
    const res = await handleBounce(bounce);
    return { matched: 0, bounce: res };
  }

  const email = extractEmailAddress(from);
  if (!email) return { matched: 0 };

  // Un même email peut correspondre à des leads chez plusieurs comptes
  const leads = await findLeadsByEmail(email);
  if (!leads.length) {
    logger.info('[Inbound] Réponse sans lead correspondant', { email });
    return { matched: 0 };
  }

  const snippet = String(text).replace(/\s+/g, ' ').trim().slice(0, 280);

  for (const lead of leads) {
    // Stoppe la séquence + pipeline rappeler + événement timeline (1 helper)
    await recordInboundReply(lead.id, lead.user_id, subject, snippet);
    // Notifie le propriétaire
    await notifyOwnerOfReply(await repo.users.findById(lead.user_id), lead, subject, snippet);
  }

  logger.info('[Inbound] Réponse traitée', { email, leads: leads.length });
  return { matched: leads.length };
}

export function isInboundActive() {
  return config.features.inbound.enabled && !!config.features.inbound.secret;
}
