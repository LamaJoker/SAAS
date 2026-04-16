import { logger } from '../utils/logger.js';

/**
 * Service d'envoi WhatsApp via Twilio Business API.
 *
 * Canal secondaire (après email) pour maximiser le reach.
 * Taux d'ouverture WhatsApp : ~90% vs ~25% email.
 *
 * Configuration .env :
 *   TWILIO_ACCOUNT_SID=ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
 *   TWILIO_AUTH_TOKEN=your_auth_token
 *   TWILIO_WHATSAPP_NUMBER=whatsapp:+14155238886  (sandbox Twilio)
 *
 * Pour la prod : utiliser un numéro WhatsApp Business approuvé Meta.
 */

let twilioClient = null;

function getClient() {
  if (twilioClient) return twilioClient;

  const { TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN } = process.env;
  if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN) return null;

  try {
    const twilio = (await import('twilio')).default;
    twilioClient = twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);
    return twilioClient;
  } catch {
    logger.warn('[WhatsApp] Module twilio non installé — npm install twilio');
    return null;
  }
}

/**
 * Normalise un numéro de téléphone français au format E.164.
 * Gère les formats : 06 12 34 56 78 / +336... / 0033...
 * @param {string} phone
 * @returns {string|null} Format E.164 (+33612345678) ou null si invalide
 */
export function normalizePhone(phone) {
  if (!phone) return null;

  const cleaned = phone.replace(/[\s.\-()]/g, '');

  // Déjà en E.164
  if (/^\+\d{10,15}$/.test(cleaned)) return cleaned;

  // Format international sans +
  if (/^0033\d{9}$/.test(cleaned)) return `+33${cleaned.slice(4)}`;

  // Format national français (06, 07, 01-09)
  if (/^0[1-9]\d{8}$/.test(cleaned)) return `+33${cleaned.slice(1)}`;

  logger.warn('[WhatsApp] Numéro non normalisable', { phone });
  return null;
}

/**
 * Envoie un message WhatsApp de présentation de la démo.
 * Non bloquant : les erreurs sont loggées mais ne font pas échouer le job principal.
 *
 * @param {{
 *   phone: string,
 *   name: string,
 *   url: string,
 *   senderName?: string
 * }} params
 * @returns {Promise<{ sid: string, status: string }|{ error: string, skipped: true }>}
 */
export async function sendWhatsAppDemo({ phone, name, url, senderName = 'AutoDemo' }) {
  const client = await getClient();
  if (!client) {
    return { skipped: true, error: 'Twilio non configuré' };
  }

  const normalized = normalizePhone(phone);
  if (!normalized) {
    return { skipped: true, error: `Numéro invalide: ${phone}` };
  }

  const whatsappFrom = process.env.TWILIO_WHATSAPP_NUMBER ?? 'whatsapp:+14155238886';

  const body =
    `Bonjour 👋\n\n` +
    `J'ai créé un site démo pour *${name}* :\n` +
    `${url}\n\n` +
    `Dites-moi ce que vous en pensez — répondez à ce message !\n\n` +
    `— ${senderName}`;

  try {
    const message = await client.messages.create({
      from: whatsappFrom,
      to: `whatsapp:${normalized}`,
      body,
    });

    logger.info('[WhatsApp] Message envoyé', { to: normalized, sid: message.sid });
    return { sid: message.sid, status: message.status };
  } catch (err) {
    // Non bloquant — WhatsApp est un canal bonus
    logger.warn('[WhatsApp] Envoi échoué', { to: normalized, error: err.message, code: err.code });
    return { skipped: true, error: err.message };
  }
}

/**
 * Envoie une relance WhatsApp (J+3 après la démo).
 * Ton différent du premier message — plus direct.
 *
 * @param {{ phone: string, name: string, url: string, senderName?: string }} params
 */
export async function sendWhatsAppFollowup({ phone, name, url, senderName = 'AutoDemo' }) {
  const client = await getClient();
  if (!client) return { skipped: true, error: 'Twilio non configuré' };

  const normalized = normalizePhone(phone);
  if (!normalized) return { skipped: true, error: `Numéro invalide: ${phone}` };

  const whatsappFrom = process.env.TWILIO_WHATSAPP_NUMBER ?? 'whatsapp:+14155238886';

  const body =
    `Bonjour,\n\n` +
    `Je reviens vers vous au sujet de la démo pour *${name}*.\n\n` +
    `${url}\n\n` +
    `Avez-vous eu le temps de la regarder ?\n\n` +
    `— ${senderName}`;

  try {
    const message = await client.messages.create({
      from: whatsappFrom,
      to: `whatsapp:${normalized}`,
      body,
    });
    logger.info('[WhatsApp] Relance envoyée', { to: normalized, sid: message.sid });
    return { sid: message.sid, status: message.status };
  } catch (err) {
    logger.warn('[WhatsApp] Relance échouée', { to: normalized, error: err.message });
    return { skipped: true, error: err.message };
  }
}

/**
 * Vérifie que les credentials Twilio sont valides.
 * À appeler au démarrage pour diagnostic rapide.
 * @returns {Promise<boolean>}
 */
export async function verifyWhatsApp() {
  const client = await getClient();
  if (!client) {
    logger.warn('[WhatsApp] Non configuré — canal désactivé');
    return false;
  }
  try {
    await client.api.accounts(process.env.TWILIO_ACCOUNT_SID).fetch();
    logger.info('[WhatsApp] Credentials Twilio valides');
    return true;
  } catch (err) {
    logger.warn('[WhatsApp] Credentials invalides', { error: err.message });
    return false;
  }
}
