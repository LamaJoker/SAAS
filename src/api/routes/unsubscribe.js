import express from 'express';
import { getDb }  from '../../db/database.js';
import { logger } from '../../utils/logger.js';

const router = express.Router();

router.get('/:token', (req, res) => {
  try {
    const email = Buffer.from(req.params.token, 'base64url').toString('utf8');
    if (!email || !email.includes('@')) {
      return res.status(400).send('Lien invalide.');
    }

    const db = getDb();
    db.prepare("INSERT OR IGNORE INTO email_blacklist (email, reason) VALUES (?, 'unsubscribe')")
      .run(email.toLowerCase());

    logger.info('[Unsubscribe] Désabonnement', { email });
    res.send(`
      <!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8">
      <title>Désabonnement</title>
      <style>body{font-family:Arial,sans-serif;max-width:480px;margin:80px auto;text-align:center;color:#333}
      h1{font-size:22px}p{color:#666}</style></head>
      <body><h1>✓ Désabonnement confirmé</h1>
      <p>L'adresse <strong>${email}</strong> a été retirée de notre liste.</p>
      <p>Vous ne recevrez plus d'emails de notre part.</p></body></html>
    `);
  } catch (err) {
    logger.error('[Unsubscribe] Erreur', { error: err.message });
    res.status(500).send('Erreur lors du désabonnement.');
  }
});

export default router;
