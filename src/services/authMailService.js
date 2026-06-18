/**
 * authMailService.js — Emails transactionnels du cycle de vie du compte
 * (vérification d'adresse, réinitialisation de mot de passe).
 *
 * Si SMTP n'est pas configuré (développement), le lien est loggé en clair
 * pour que le flux reste testable sans serveur mail.
 */
import { smtpPool } from './smtpPool.js';
import { logger }   from '../utils/logger.js';
import { config }   from '../config/config.js';

function wrap(title, bodyHtml) {
  return `
<div style="font-family:Arial,sans-serif;font-size:14px;color:#222;max-width:520px;line-height:1.7">
  <p style="font-size:16px;font-weight:bold">${title}</p>
  ${bodyHtml}
  <p style="color:#999;font-size:11px;margin-top:24px">
    Si vous n'êtes pas à l'origine de cette demande, ignorez cet email.
  </p>
</div>`;
}

export async function sendVerificationEmail(email, token) {
  const url = `${config.server.baseUrl}/users/verify/${token}`;

  if (!smtpPool.isConfigured) {
    logger.warn(`[AuthMail] SMTP non configuré — lien de vérification: ${url}`);
    return { skipped: true, url };
  }

  await smtpPool.send({
    to:      email,
    subject: 'Confirmez votre adresse email — AutoDemo',
    text:    `Bienvenue sur AutoDemo !\n\nConfirmez votre adresse : ${url}\n\nCe lien expire dans 48h.`,
    html: wrap('Bienvenue sur AutoDemo 👋', `
      <p>Confirmez votre adresse email pour activer la génération de sites :</p>
      <p style="margin:20px 0">
        <a href="${url}" style="background:#5b8cf5;color:#fff;padding:12px 26px;border-radius:6px;text-decoration:none;font-weight:bold;display:inline-block">
          Confirmer mon adresse
        </a>
      </p>`),
  });
  return { sent: true };
}

export async function sendResetEmail(email, token) {
  const url = `${config.server.baseUrl}/reset.html?token=${token}`;

  if (!smtpPool.isConfigured) {
    logger.warn(`[AuthMail] SMTP non configuré — lien de reset: ${url}`);
    return { skipped: true, url };
  }

  await smtpPool.send({
    to:      email,
    subject: 'Réinitialisation de votre mot de passe — AutoDemo',
    text:    `Réinitialisez votre mot de passe : ${url}\n\nCe lien expire dans 1 heure.`,
    html: wrap('Réinitialisation du mot de passe', `
      <p>Cliquez sur le bouton pour choisir un nouveau mot de passe (valable 1 heure) :</p>
      <p style="margin:20px 0">
        <a href="${url}" style="background:#5b8cf5;color:#fff;padding:12px 26px;border-radius:6px;text-decoration:none;font-weight:bold;display:inline-block">
          Choisir un nouveau mot de passe
        </a>
      </p>`),
  });
  return { sent: true };
}
