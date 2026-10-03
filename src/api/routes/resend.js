import express from 'express';
import { repo }          from '../../db/repo.js';
import { sendDemoEmail } from '../../services/emailService.js';
import { Errors }        from '../../utils/AppError.js';
import { logger }        from '../../utils/logger.js';
import { parseDbDate }   from '../../utils/utils.js';

const router = express.Router();

/** Raison d'un envoi refusé → message affiché tel quel dans le dashboard. */
function skipMessage({ reason, nextSendAt, followUpDays }) {
  switch (reason) {
    case 'smtp_not_configured': return "Envoi d'emails non configuré sur ce serveur (SMTP).";
    case 'no_email':            return "Ce prospect n'a pas d'adresse email.";
    case 'blacklisted':         return "Ce prospect s'est désabonné ou son adresse est invalide : plus aucun envoi possible.";
    case 'sequence_active':     return `Une relance automatique est déjà programmée${nextSendAt ? ` (${formatDate(nextSendAt)})` : ''} : inutile de relancer à la main.`;
    case 'sequence_complete':   return 'Ce prospect a déjà reçu 3 emails, le maximum : appelez-le plutôt.';
    case 'too_soon':            return `Dernier email envoyé il y a moins de ${followUpDays} jours : attendez avant de relancer.`;
    default:                    return 'Email non envoyé.';
  }
}

function formatDate(sqliteUtc) {
  const d = parseDbDate(sqliteUtc);
  return Number.isNaN(d.getTime()) ? sqliteUtc
    : d.toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Europe/Paris' });
}

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
      return res.json({ success: true, data: { sent: false, reason: result.reason, message: skipMessage(result) } });
    }

    logger.info('[Resend] Email relancé', { siteId: site.id, leadEmail: lead.email });
    res.json({ success: true, data: { sent: true, to: lead.email, variant: result.variant } });
  } catch (err) {
    logger.error('[Resend] Erreur', { error: err.message });
    next(err);
  }
});

export default router;
