/**
 * routes/unsubscribe.js — Désinscription des prospects.
 *
 *   GET  /unsubscribe/:token → page de confirmation, AUCUNE écriture ;
 *   POST /unsubscribe/:token → désinscrit.
 *
 * Le POST sert deux clients :
 *   - le bouton « Se désabonner » natif de Gmail / Yahoo / Apple Mail, qui
 *     POSTe `List-Unsubscribe=One-Click` (RFC 8058, en-tête
 *     List-Unsubscribe-Post posé sur chaque email) ;
 *   - le bouton de la page de confirmation, pour qui clique le lien du footer.
 *
 * Pourquoi pas de désinscription au GET : les passerelles de sécurité de
 * messagerie visitent les liens des emails reçus. Chaque visite désinscrivait
 * le prospect à son insu — lead perdu sans qu'il l'ait demandé. C'est
 * précisément la raison d'être du POST dans la RFC 8058.
 */
import express from 'express';
import { unsubscribeEmail } from '../../db/queries.js';
import { logger } from '../../utils/logger.js';
import { verifyUnsubToken } from '../../utils/unsubToken.js';
import { sanitize } from '../../utils/utils.js';

const router = express.Router();

const PAGE_CSP = [
  "default-src 'none'",
  "style-src 'unsafe-inline'",
  "form-action 'self'",
  "base-uri 'none'",
  "frame-ancestors 'none'",
].join('; ');

/** `content` doit être déjà échappé par l'appelant. */
function page(title, content) {
  return `<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex">
<title>${title}</title>
<style>body{font-family:Arial,sans-serif;max-width:480px;margin:80px auto;padding:0 20px;text-align:center;color:#333}
h1{font-size:22px}p{color:#666}button{margin-top:16px;padding:12px 28px;font-size:15px;border:0;border-radius:6px;background:#333;color:#fff;cursor:pointer}</style>
</head><body>${content}</body></html>`;
}

function send(res, status, html) {
  res.setHeader('Content-Security-Policy', PAGE_CSP);
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  res.status(status).send(html);
}

const INVALID = page('Désabonnement', '<h1>Lien de désabonnement invalide</h1>'
  + '<p>Ce lien a été altéré. Répondez simplement à l\'email reçu en demandant votre désinscription.</p>');

router.get('/:token', (req, res) => {
  const email = verifyUnsubToken(req.params.token);
  if (!email) return send(res, 400, INVALID);

  send(res, 200, page('Désabonnement', `
    <h1>Se désabonner</h1>
    <p>L'adresse <strong>${sanitize(email)}</strong> ne recevra plus aucun email de notre part.</p>
    <form method="post" action="/unsubscribe/${encodeURIComponent(req.params.token)}">
      <button type="submit">Confirmer le désabonnement</button>
    </form>`));
});

router.post('/:token', async (req, res) => {
  const email = verifyUnsubToken(req.params.token);
  if (!email) return send(res, 400, INVALID);

  try {
    await unsubscribeEmail(email); // idempotent : un second POST ne change rien
    logger.info('[Unsubscribe] Désabonnement', {
      email, oneClick: req.body?.['List-Unsubscribe'] === 'One-Click',
    });
    send(res, 200, page('Désabonnement', `
      <h1>✓ Désabonnement confirmé</h1>
      <p>L'adresse <strong>${sanitize(email)}</strong> a été retirée de notre liste.</p>
      <p>Vous ne recevrez plus d'emails de notre part.</p>`));
  } catch (err) {
    logger.error('[Unsubscribe] Erreur', { error: err.message });
    send(res, 500, page('Désabonnement', '<h1>Erreur</h1>'
      + '<p>Le désabonnement n\'a pas pu être enregistré. Réessayez, ou répondez à l\'email reçu.</p>'));
  }
});

export default router;
