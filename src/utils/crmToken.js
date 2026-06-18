import { createHmac, timingSafeEqual } from 'crypto';
import { config } from '../config/config.js';

/**
 * Token d'action CRM en un clic, signé HMAC-SHA256 (même patron que unsubToken).
 * Permet au propriétaire de changer le statut d'un lead depuis l'email de
 * notification, sans login. Expire après 7 jours.
 *
 * Format : base64url("leadId:action:expiresMs") + "." + 16 chars de signature.
 */

export const CRM_ACTIONS = ['converti', 'contacte', 'rappeler', 'perdu'];

function sign(payload) {
  return createHmac('sha256', config.security.jwtSecret)
    .update(`crm:${payload}`).digest('base64url').slice(0, 16);
}

export function buildCrmToken(leadId, action, ttlDays = 7) {
  if (!CRM_ACTIONS.includes(action)) throw new Error(`Action CRM invalide: ${action}`);
  const expires = Date.now() + ttlDays * 86_400_000;
  const payload = Buffer.from(`${leadId}:${action}:${expires}`).toString('base64url');
  return `${payload}.${sign(payload)}`;
}

/** @returns {{ leadId, action } | null} */
export function verifyCrmToken(token) {
  if (typeof token !== 'string' || token.length > 512) return null;

  const dot = token.lastIndexOf('.');
  if (dot === -1) return null;

  const payload  = token.slice(0, dot);
  const sig      = token.slice(dot + 1);
  const expected = sign(payload);

  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  try {
    const [leadId, action, expires] = Buffer.from(payload, 'base64url').toString('utf8').split(':');
    if (!leadId || !CRM_ACTIONS.includes(action)) return null;
    if (!expires || Date.now() > parseInt(expires, 10)) return null;
    return { leadId, action };
  } catch {
    return null;
  }
}
