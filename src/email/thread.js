/**
 * thread.js — Fil de conversation des emails de prospection.
 *
 * Une relance est une VRAIE réponse au premier email :
 *   - objet « Re: <objet exact du premier email> » ;
 *   - In-Reply-To / References vers les Message-ID déjà envoyés ;
 *   - même compte d'envoi que le premier email (adresse stable dans le fil).
 *
 * Gmail et Outlook regroupent alors J0, J+3 et J+7 en une conversation, et le
 * prospect revoit le premier message — lien de la démo compris — sous chaque
 * relance. Auparavant, l'objet « Re: {nom} » simulait une réponse à un message
 * qui n'avait jamais existé : signal repéré par les filtres anti-spam, et
 * pratique trompeuse.
 *
 * Sans fil exploitable (premier envoi, ou envoi antérieur à la migration v14
 * dont l'objet n'a pas été conservé), l'email part avec l'objet propre de sa
 * variante — jamais de « Re: » inventé.
 */

// Un Message-ID est une valeur d'en-tête : aucun espace ni retour à la ligne
// (injection d'en-têtes), chevrons obligatoires.
const MESSAGE_ID_RE = /^<?([^\s<>]+@[^\s<>]+)>?$/;

export function normalizeMessageId(value) {
  const m = typeof value === 'string' ? value.trim().match(MESSAGE_ID_RE) : null;
  return m ? `<${m[1]}>` : null;
}

/**
 * @param {Array<{message_id: string, subject: string|null, sent_via: string|null}>} previous
 *        emails déjà envoyés pour ce site, du plus ancien au plus récent
 * @param {string} ownSubject  objet de la variante, utilisé hors fil
 * @returns {{ subject: string, headers: object, preferSender: string|null }}
 */
export function buildThread(previous, ownSubject) {
  const first   = previous?.[0];
  const rootId  = normalizeMessageId(first?.message_id);
  const rootSub = first?.subject?.replace(/^\s*(re:\s*)+/i, '').trim();

  if (!rootId || !rootSub) {
    return { subject: ownSubject, headers: {}, preferSender: first?.sent_via ?? null };
  }

  const ids = previous.map(p => normalizeMessageId(p.message_id)).filter(Boolean);
  return {
    subject: `Re: ${rootSub}`,
    headers: {
      'In-Reply-To': ids.at(-1),     // le message auquel on répond : le plus récent
      'References':  ids.join(' '),  // toute la chaîne, du plus ancien au plus récent
    },
    preferSender: first.sent_via ?? null,
  };
}
