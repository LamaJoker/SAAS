import express from 'express';
import { Lead }              from '../../db/models/Lead.js';
import { generateSiteForLead } from '../../services/siteService.js';
import { sendDemoEmail }      from '../../services/emailService.js';
import { generateLimiter }    from '../middleware/rateLimiter.js';
import { validateLead }       from '../middleware/validate.js';
import { Errors }             from '../../utils/AppError.js';
import { logger }             from '../../utils/logger.js';

const router = express.Router();

const ALLOWED_VARIANTS = ['curiosite', 'direct', 'relance_soft', 'relance_directe'];

export const EMAIL_TEMPLATES = [
  { id: 'curiosite',       label: 'Curiosité — accroche douce' },
  { id: 'direct',          label: 'Direct — droit au but' },
  { id: 'relance_soft',    label: 'Relance soft — ton léger' },
  { id: 'relance_directe', label: 'Relance directe — dernier message' },
];

router.get('/templates', (_req, res) => {
  res.json({ success: true, data: EMAIL_TEMPLATES });
});

router.post('/', generateLimiter, validateLead, async (req, res, next) => {
  try {
    const { name, activity, city, email, phone, variantId, sendEmail = true } = req.body;

    if (sendEmail && !email) {
      return next(Errors.badRequest("Un email est requis pour envoyer la démo (ou désactivez 'sendEmail')"));
    }
    if (variantId && !ALLOWED_VARIANTS.includes(variantId)) {
      return next(Errors.badRequest(`variantId invalide. Valeurs: ${ALLOWED_VARIANTS.join(', ')}`));
    }

    const lead = Lead.create({ userId: req.userId, name, activity, city, email, phone });

    let site;
    try {
      site = await generateSiteForLead({ userId: req.userId, leadId: lead.id });
    } catch (err) {
      Lead.deleteById(lead.id);
      throw err;
    }

    let emailResult = { sent: false, skipped: true, reason: 'not_requested' };
    if (sendEmail && email) {
      try {
        const fullLead = Lead.findById(lead.id);
        const r = await sendDemoEmail({
          lead: fullLead,
          site,
          forceVariantId: variantId ?? null,
        });
        emailResult = r.sent
          ? { sent: true, variant: r.variant, messageId: r.messageId }
          : { sent: false, skipped: true, reason: r.reason };
      } catch (err) {
        logger.error('[QuickDemo] Envoi email échoué', { leadId: lead.id, error: err.message });
        emailResult = { sent: false, skipped: true, reason: 'send_error', error: err.message };
      }
    }

    logger.info('[QuickDemo] Démo créée', { leadId: lead.id, siteId: site.id, sentEmail: emailResult.sent });

    res.status(201).json({
      success: true,
      data: {
        lead,
        site: { id: site.id, slug: site.slug, url: site.url },
        email: emailResult,
      },
    });
  } catch (err) {
    next(err);
  }
});

export default router;
