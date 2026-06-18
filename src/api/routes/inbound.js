/**
 * routes/inbound.js — Webhook de réception des réponses email.
 *
 * Activable : INBOUND_ENABLED=true + INBOUND_SECRET. Configurez votre
 * fournisseur (SendGrid Inbound Parse, Mailgun Routes, Postmark…) pour POSTer
 * en JSON vers /inbound/<INBOUND_SECRET>. Le secret dans l'URL fait office
 * d'authentification (comparé en temps constant).
 *
 * Champs acceptés (tolérant aux formats fournisseurs) :
 *   from / sender / From   ·   subject / Subject   ·   text / body-plain / TextBody
 */
import express from 'express';
import { timingSafeEqual } from 'crypto';
import { handleInboundEmail, isInboundActive } from '../../services/inboundService.js';
import { config } from '../../config/config.js';
import { logger } from '../../utils/logger.js';

const router = express.Router();

function secretOk(provided) {
  const expected = config.features.inbound.secret;
  if (!expected || typeof provided !== 'string') return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

router.post('/:secret', async (req, res) => {
  if (!isInboundActive()) {
    return res.status(503).json({ success: false, error: 'Réception entrante désactivée' });
  }
  if (!secretOk(req.params.secret)) {
    return res.status(403).json({ success: false, error: 'Secret invalide' });
  }

  const b = req.body || {};
  const from    = b.from    ?? b.sender   ?? b.From    ?? '';
  const subject = b.subject ?? b.Subject  ?? '';
  const text    = b.text    ?? b['body-plain'] ?? b.TextBody ?? '';

  try {
    const result = await handleInboundEmail({ from, subject, text });
    res.json({ success: true, data: result });
  } catch (err) {
    logger.error('[Inbound] Webhook erreur', { error: err.message });
    res.status(500).json({ success: false, error: 'Erreur de traitement' });
  }
});

export default router;
