import { SmtpPool } from './SmtpPool.js';
import { logger } from '../utils/logger.js';

/**
 * Instance singleton du SmtpPool.
 *
 * Configuration via .env :
 *
 * Cas 1 — Multi-IP (recommandé pour > 100 emails/jour) :
 *   SMTP_POOL_JSON=[{"host":"smtp.resend.com","port":587,"user":"ip1@dom.com","pass":"xxx","senderName":"Alex","hourlyLimit":80},...]
 *
 * Cas 2 — IP unique (< 100 emails/jour) :
 *   SMTP_HOST=smtp.brevo.com
 *   SMTP_PORT=587
 *   SMTP_USER=user@domain.com
 *   SMTP_PASS=secret
 *   SMTP_SENDER_NAME=AutoDemo
 */

function buildConfigs() {
  // Priorité 1 : JSON pool complet
  if (process.env.SMTP_POOL_JSON) {
    try {
      const parsed = JSON.parse(process.env.SMTP_POOL_JSON);
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    } catch (err) {
      logger.error('[SmtpPool] SMTP_POOL_JSON invalide', { error: err.message });
    }
  }

  // Priorité 2 : variables simples (fallback mono-IP)
  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_SENDER_NAME } = process.env;
  if (SMTP_HOST && SMTP_USER && SMTP_PASS) {
    return [{
      host: SMTP_HOST,
      port: SMTP_PORT ? parseInt(SMTP_PORT) : 587,
      user: SMTP_USER,
      pass: SMTP_PASS,
      senderName: SMTP_SENDER_NAME ?? 'AutoDemo',
      hourlyLimit: 80,
    }];
  }

  logger.warn('[SmtpPool] Aucune configuration SMTP trouvée — emails désactivés');
  return [];
}

const configs = buildConfigs();

export const smtpPool = configs.length > 0
  ? new SmtpPool(configs)
  : null;

/**
 * Vérifie que le pool est prêt. À appeler au démarrage du serveur.
 * Ne bloque pas si le pool est null (emails simplement désactivés).
 */
export async function verifySmtpPool() {
  if (!smtpPool) {
    logger.warn('[SmtpPool] Pool non initialisé — envoi email désactivé');
    return false;
  }
  try {
    const activeCount = await smtpPool.verify();
    logger.info(`[SmtpPool] Prêt — ${activeCount} transporteur(s) actif(s)`);
    return true;
  } catch (err) {
    logger.error('[SmtpPool] Vérification échouée', { error: err.message });
    return false;
  }
}
