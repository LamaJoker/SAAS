import { curiosite }   from './curiosite.js';
import { direct }      from './direct.js';
import { court }       from './court.js';
import { probleme }    from './probleme.js';
import { opportunite } from './opportunite.js';
import { relance_soft }    from '../followup/relance_soft.js';
import { relance_directe } from '../followup/relance_directe.js';

/**
 * @typedef {Object} EmailVariant
 * @property {string}   id
 * @property {string}   label
 * @property {string}   style
 * @property {'high'|'medium'|'low'} priority
 * @property {(ctx: EmailContext) => string} subject
 * @property {(ctx: EmailContext) => string} preheader
 * @property {(ctx: EmailContext) => string} text
 * @property {(ctx: EmailContext) => string} html
 */

/**
 * @typedef {Object} EmailContext
 * @property {string} name       - Nom de l'entreprise
 * @property {string} city       - Ville
 * @property {string} url        - URL de la démo
 * @property {string} sender     - Nom de l'expéditeur
 * @property {string} unsubUrl   - URL de désabonnement
 * @property {string} [phone]    - Téléphone (optionnel)
 */

/** Tous les variants de premier contact */
export const VARIANTS = {
  curiosite,
  direct,
  court,
  probleme,
  opportunite,
};

/** Variants de suivi / relance */
export const FOLLOWUP_VARIANTS = {
  relance_soft,
  relance_directe,
};

export const VARIANT_KEYS = Object.keys(VARIANTS);
export const FOLLOWUP_KEYS = Object.keys(FOLLOWUP_VARIANTS);

/**
 * Sélectionne un variant de premier contact.
 * Priorité : forceId > variant forcé en env > aléatoire pondéré.
 *
 * @param {string|null} forceId
 * @returns {EmailVariant}
 */
export function pickVariant(forceId = null) {
  if (forceId && VARIANTS[forceId]) return VARIANTS[forceId];

  const envForce = process.env.EMAIL_FORCE_VARIANT;
  if (envForce && VARIANTS[envForce]) return VARIANTS[envForce];

  // Pondération par priorité : high=3, medium=2, low=1
  const weights = { high: 3, medium: 2, low: 1 };
  const pool = VARIANT_KEYS.flatMap(k => {
    const v = VARIANTS[k];
    return Array(weights[v.priority] ?? 1).fill(k);
  });

  return VARIANTS[pool[Math.floor(Math.random() * pool.length)]];
}

/**
 * Détermine le bon variant de relance selon le nombre d'emails déjà envoyés.
 *
 * Séquence :
 *   0 envoi  → null (géré par pickVariant)
 *   1 envoi  → relance_soft (après FOLLOW_UP_DAYS)
 *   2 envois → relance_directe (après FOLLOW_UP_DAYS supplémentaires)
 *   3+ envois → null (arrêt de la séquence)
 *
 * @param {number} emailsSent    - Nombre d'emails déjà envoyés pour ce site
 * @param {number} daysSinceLast - Jours depuis le dernier envoi
 * @param {number} followUpDays  - Délai minimum entre deux relances (défaut 3)
 * @returns {EmailVariant|null}
 */
export function pickFollowupVariant(emailsSent, daysSinceLast, followUpDays = 3) {
  if (emailsSent === 0 || emailsSent >= 3) return null;
  if (daysSinceLast < followUpDays) return null;

  if (emailsSent === 1) return FOLLOWUP_VARIANTS.relance_soft;
  if (emailsSent === 2) return FOLLOWUP_VARIANTS.relance_directe;
  return null;
}

/**
 * Construit le contexte standard pour le rendu d'un variant.
 * Centralise la génération de l'URL de désabonnement.
 *
 * @param {{ lead, site, senderName }} params
 * @returns {EmailContext}
 */
export function buildEmailContext({ lead, site, senderName }) {
  const baseUrl = process.env.BASE_URL ?? 'http://localhost:3000';
  const unsubToken = Buffer.from(lead.email ?? '').toString('base64url');

  return {
    name:      lead.name,
    city:      lead.city,
    url:       site.url,
    sender:    senderName,
    unsubUrl:  `${baseUrl}/unsubscribe/${unsubToken}`,
    phone:     lead.phone ?? null,
  };
}
