/**
 * routes/resend.js — Relance d'email de prospection pour un site
 */
import express from 'express';
import { Site } from '../../db/models/Site.js';
import { Lead } from '../../db/models/Lead.js';
import { Errors } from '../../utils/AppError.js';
import { logger } from '../../utils/logger.js';

const router = express.Router();

// POST /resend/:siteId
router.post('/:siteId', async (req, res, next) => {
  try {
    const { siteId } = req.params;

    const site = Site.findById(siteId);
    if (!site) return next(Errors.notFound('Site introuvable'));
    if (site.user_id !== req.userId) return next(Errors.forbidden());

    const lead = Lead.findById(site.lead_id);
    if (!lead?.email) return next(Errors.badRequest('Ce lead n\'a pas d\'email'));

    // Setup SMTP
    const host = process.env.SMTP_HOST;
    const user = process.env.SMTP_USER;
    const pass = process.env.SMTP_PASS;

    if (!host || !user || !pass) {
      return next(Errors.badRequest('SMTP non configuré'));
    }

    const nodemailer = await import('nodemailer');
    const transporter = nodemailer.default.createTransport({
      host,
      port: parseInt(process.env.SMTP_PORT || '587'),
      secure: process.env.SMTP_PORT === '465',
      auth: { user, pass },
    });

    const sender = process.env.SMTP_SENDER_NAME || 'AutoDemo';
    const from = process.env.SMTP_FROM || user;

    await transporter.sendMail({
      from: `"${sender}" <${from}>`,
      to: lead.email,
      subject: `🔔 Rappel — Votre site démo ${lead.name} vous attend`,
      text: `Bonjour,\n\nNous vous relançons au sujet de votre démo : ${site.url}\n\nBonne journée,\n${sender}`,
      html: `<!DOCTYPE html><html><head><meta charset="UTF-8"></head><body style="font-family:Arial,sans-serif;color:#374151;padding:28px">
        <h2 style="color:#6366f1">🔔 Rappel — Votre démo vous attend</h2>
        <p>Bonjour,</p>
        <p>Nous vous relançons concernant le site démo créé pour <strong>${lead.name}</strong>.</p>
        <p><a href="${site.url}" style="background:#6366f1;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:bold">Voir ma démo →</a></p>
        <p style="margin-top:24px">Bonne journée,<br><strong>${sender}</strong></p>
      </body></html>`,
    });

    logger.info('Resend email sent', { siteId, to: lead.email });
    res.json({ success: true, data: { sent: true, to: lead.email } });
  } catch (err) {
    logger.error('Resend email error', { error: err.message });
    next(err);
  }
});

export default router;
