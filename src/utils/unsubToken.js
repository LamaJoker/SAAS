import { createHmac, timingSafeEqual } from 'crypto';
import { config } from '../config/config.js';

/**
 * Token de désinscription signé HMAC-SHA256.
 * Format : base64url(email) + "." + 16 premiers chars de la signature.
 * Utilisé par emailService, sequenceService et la route /unsubscribe.
 */

function sign(payload) {
  return createHmac('sha256', config.security.jwtSecret)
    .update(payload).digest('base64url').slice(0, 16);
}

export function buildUnsubToken(email) {
  const payload = Buffer.from(email.toLowerCase()).toString('base64url');
  return `${payload}.${sign(payload)}`;
}

/**
 * Vérifie la signature et retourne l'email, ou null si le token est invalide.
 */
export function verifyUnsubToken(token) {
  if (typeof token !== 'string' || token.length > 512) return null;

  const dot = token.lastIndexOf('.');
  if (dot === -1) return null;

  const payload = token.slice(0, dot);
  const sig     = token.slice(dot + 1);
  const expected = sign(payload);

  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  try {
    const email = Buffer.from(payload, 'base64url').toString('utf8');
    if (!email.includes('@') || email.length > 254) return null;
    return email.toLowerCase();
  } catch {
    return null;
  }
}
