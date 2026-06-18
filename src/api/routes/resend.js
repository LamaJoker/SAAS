import express from 'express';
import { repo }          from '../../db/repo.js';
import { sendDemoEmail } from '../../services/emailService.js';
import { Errors }        from '../../utils/AppError.js';
import { logger }        from '../../utils/logger.js';

const router = express.Router();

router.post('/:siteId', async (req, res, next) => {
  try {
    const site = await repo.sites.findById(req.params.siteId);
    if (!site)                        return next(Errors.notFound('Site introuvable'));
    if (site.user_id !== req.userId)  return next(Errors.forbidden());

    const lead = await repo.leads.findById(site.lead_id);
    if (!lead?.email) return next(Errors.badRequest("Ce lead n'a pas d'email"));

    const result = await sendDemoEmail({
      lead,
      site,
      forceVariantId: req.body.variantId ?? null,
    });

    if (result.skipped) {
      return res.json({ success: true, data: { sent: false, reason: result.reason } });
    }

    logger.info('[Resend] Email relancé', { siteId: site.id, leadEmail: lead.email });
    res.json({ success: true, data: { sent: true, to: lead.email, variant: result.variant } });
  } catch (err) {
    logger.error('[Resend] Erreur', { error: err.message });
    next(err);
  }
});

export default router;
