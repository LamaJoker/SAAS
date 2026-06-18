import express from 'express';
import { unsubscribeEmail } from '../../db/queries.js';
import { logger } from '../../utils/logger.js';
import { verifyUnsubToken } from '../../utils/unsubToken.js';
import { sanitize } from '../../utils/utils.js';

const router = express.Router();

router.get('/:token', async (req, res) => {
  try {
    // Signature HMAC obligatoire : un token forgé est rejeté
    const email = verifyUnsubToken(req.params.token);
    if (!email) {
      return res.status(400).send('Lien de désabonnement invalide ou expiré.');
    }

    await unsubscribeEmail(email);

    logger.info('[Unsubscribe] Désabonnement', { email });
    res.send(`
      <!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8">
      <title>Désabonnement</title>
      <style>body{font-family:Arial,sans-serif;max-width:480px;margin:80px auto;text-align:center;color:#333}
      h1{font-size:22px}p{color:#666}</style></head>
      <body><h1>✓ Désabonnement confirmé</h1>
      <p>L'adresse <strong>${sanitize(email)}</strong> a été retirée de notre liste.</p>
      <p>Vous ne recevrez plus d'emails de notre part.</p></body></html>
    `);
  } catch (err) {
    logger.error('[Unsubscribe] Erreur', { error: err.message });
    res.status(500).send('Erreur lors du désabonnement.');
  }
});

export default router;
