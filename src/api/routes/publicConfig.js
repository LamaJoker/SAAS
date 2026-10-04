/**
 * routes/publicConfig.js — Configuration lisible sans connexion.
 *
 * Les pages publiques (accueil, connexion) en ont besoin avant toute
 * authentification. N'expose QUE des drapeaux d'affichage : jamais de secret,
 * de quota ni d'état interne.
 */
import express from 'express';
import { config } from '../../config/config.js';

const router = express.Router();

router.get('/', (req, res) => {
  res.setHeader('Cache-Control', 'public, max-age=300');
  res.json({ success: true, data: { showcase: config.showcase.enabled } });
});

export default router;
