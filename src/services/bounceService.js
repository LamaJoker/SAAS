/**
 * bounceService.js — Détection et traitement des rebonds email (NDR / DSN).
 *
 * Pourquoi c'est critique
 * ───────────────────────
 * Une adresse scrapée sur deux est morte ou inventée. Sans traitement des
 * rebonds, ces adresses restent dans la base, la séquence continue de leur
 * écrire, et le taux de rebond du domaine explose. Gmail et Outlook coupent
 * vers 2 % de hard bounces : le domaine d'envoi est alors grillé, et le warmup
 * ne protège de rien puisque le problème n'est pas le volume mais la qualité
 * de la liste.
 *
 * Hard vs soft
 * ────────────
 * hard = l'adresse n'existe pas (5.1.1, 550) → blacklist immédiate, définitive.
 * soft = incident temporaire ou refus de politique (boîte pleine, greylisting,
 *        blocage réputation) → on compte, et on blackliste seulement après
 *        SOFT_LIMIT échecs. Blacklister un 4.x.x reviendrait à jeter des leads
 *        valides ; blacklister un 5.7.1 (blocage) reviendrait à se punir d'un
 *        problème de réputation qui vient de nous, pas du destinataire.
 *
 * parseBounce() est une fonction pure : c'est elle qui porte toute la logique
 * fragile (formats de DSN variables selon les fournisseurs), donc c'est elle
 * qui est testée.
 */
import { randomUUID } from 'node:crypto';
import { blacklistEmail, recordBounce, countRecentSoftBounces } from '../db/queries.js';
import { logger } from '../utils/logger.js';

/** Nombre de soft bounces avant blacklist (fenêtre SOFT_WINDOW_DAYS). */
export const SOFT_LIMIT = 4;
export const SOFT_WINDOW_DAYS = 30;

const DAEMON_SENDER = /^(mailer-daemon|postmaster|no-?reply|nobody)@/i;

const BOUNCE_SUBJECT = new RegExp([
  'undeliverable', 'delivery status notification', 'delivery failure',
  'delivery has failed', 'failure notice', 'returned mail', 'mail delivery failed',
  'mail delivery subsystem', 'undelivered mail returned',
  // français
  'echec de remise', 'échec de remise', 'non distribu', 'courrier non remis',
].join('|'), 'i');

/**
 * Codes 5.x.x qui signalent un refus temporaire ou de politique plutôt qu'une
 * adresse inexistante. Les traiter en hard supprimerait des leads valides.
 */
const SOFT_5XX = /^5\.(2\.[23]|3\.[14]|7\.)/;   // boîte pleine, taille msg, blocage

/**
 * Analyse un email entrant et détermine s'il s'agit d'un rebond.
 * Fonction pure : aucun accès base, aucun effet de bord.
 *
 * @param {{from?: string, subject?: string, text?: string}} msg
 * @returns {{isBounce: boolean, type: 'hard'|'soft'|null, recipient: string|null,
 *            code: string|null, diagnostic: string|null}}
 */
export function parseBounce({ from = '', subject = '', text = '' } = {}) {
  const none = { isBounce: false, type: null, recipient: null, code: null, diagnostic: null };

  const body = String(text);
  const looksLikeDaemon  = DAEMON_SENDER.test(String(from).replace(/^.*</, ''));
  const looksLikeSubject = BOUNCE_SUBJECT.test(String(subject));
  // Un rapport DSN embarque toujours au moins un de ces en-têtes.
  const hasDsnPart = /Content-Type:\s*message\/delivery-status/i.test(body)
                  || /^\s*(Final|Original)-Recipient:/im.test(body)
                  || /^\s*X-Failed-Recipients:/im.test(body);

  if (!looksLikeDaemon && !looksLikeSubject && !hasDsnPart) return none;
  // Sujet seul (« Undeliverable ») sans marqueur d'expéditeur ni DSN : trop
  // faible pour blacklister quelqu'un, on laisse passer en réponse normale.
  if (!looksLikeDaemon && !hasDsnPart) return none;

  const recipient = extractRecipient(body);
  if (!recipient) return none;

  const { code, diagnostic } = extractStatus(body);
  const type = classify(code, diagnostic);

  return { isBounce: true, type, recipient, code, diagnostic };
}

/** Adresse d'origine du message rejeté. */
function extractRecipient(body) {
  const patterns = [
    /^\s*Final-Recipient:\s*(?:rfc822|RFC822)?\s*;?\s*<?([^\s<>;]+@[^\s<>;]+)>?/im,
    /^\s*Original-Recipient:\s*(?:rfc822|RFC822)?\s*;?\s*<?([^\s<>;]+@[^\s<>;]+)>?/im,
    /^\s*X-Failed-Recipients:\s*<?([^\s<>,;]+@[^\s<>,;]+)>?/im,
    // Corps en clair : « <x@y.fr>: ... does not exist »
    /<([^\s<>]+@[^\s<>]+)>[:\s][^\n]{0,80}(?:does not exist|unknown|not found|no such user|rejected|introuvable)/i,
  ];
  for (const re of patterns) {
    const m = body.match(re);
    if (m) {
      const addr = m[1].trim().toLowerCase().replace(/[.,;]+$/, '');
      if (/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(addr)) return addr;
    }
  }
  return null;
}

/** Statut DSN (5.1.1) et code SMTP du Diagnostic-Code. */
function extractStatus(body) {
  const status = body.match(/^\s*Status:\s*([245]\.\d{1,3}\.\d{1,3})/im);
  const diag   = body.match(/^\s*Diagnostic-Code:\s*([^\n]{0,200})/im);
  const diagnostic = diag ? diag[1].trim().slice(0, 200) : null;

  if (status) return { code: status[1], diagnostic };

  // Pas de partie DSN structurée : on retombe sur le code SMTP brut.
  const smtp = (diagnostic || body).match(/\b([45]\d{2})\b(?!\.\d)/);
  return { code: smtp ? smtp[1] : null, diagnostic };
}

/** hard si l'adresse est invalide, soft dans tous les cas douteux. */
function classify(code, diagnostic) {
  if (code) {
    if (/^5\./.test(code) && !SOFT_5XX.test(code)) return 'hard';
    if (/^5\d{2}$/.test(code)) {
      // Codes SMTP bruts : 550/551/553 = destinataire inconnu, 552 = quota.
      return ['550', '551', '553'].includes(code) ? 'hard' : 'soft';
    }
    return 'soft';   // 4.x.x, 4xx, 5.2.2…
  }
  // Sans code, on se fie au libellé — et dans le doute, soft.
  return /user unknown|no such user|does not exist|address rejected|invalid recipient|utilisateur inconnu/i
    .test(String(diagnostic)) ? 'hard' : 'soft';
}

/**
 * Enregistre un rebond et blackliste l'adresse quand c'est justifié.
 *
 * @returns {Promise<{ blacklisted: boolean, type: string, email: string }>}
 */
export async function handleBounce({ recipient, type, code, diagnostic }) {
  await recordBounce({
    id: randomUUID(), email: recipient, type, code, diagnostic,
  });

  if (type === 'hard') {
    await blacklistEmail(recipient, 'bounce_hard');
    logger.warn('[Bounce] Hard bounce — adresse blacklistée', { email: recipient, code });
    return { blacklisted: true, type, email: recipient };
  }

  const recent = await countRecentSoftBounces(recipient, SOFT_WINDOW_DAYS);
  if (recent >= SOFT_LIMIT) {
    await blacklistEmail(recipient, 'bounce_soft_repeated');
    logger.warn('[Bounce] Soft bounces répétés — adresse blacklistée', {
      email: recipient, count: recent, code,
    });
    return { blacklisted: true, type, email: recipient };
  }

  logger.info('[Bounce] Soft bounce enregistré', { email: recipient, count: recent, code });
  return { blacklisted: false, type, email: recipient };
}
