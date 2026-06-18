import express from 'express';
import { repo, EVENT_TYPES } from '../../db/repo.js';
import { markContactFollowup } from '../../db/queries.js';
import { validateSlug }  from '../middleware/validate.js';
import { sanitizeInput } from '../../utils/utils.js';
import { Errors }        from '../../utils/AppError.js';
import { logger }        from '../../utils/logger.js';
import { notifyHotLead } from '../../services/notifyService.js';

const router = express.Router();

/**
 * POST /contact/:slug — Soumission du formulaire de contact d'un site démo.
 * Public (le prospect n'a pas de compte). C'est LE signal de conversion :
 * le scoring lui donne 100/100 et le propriétaire du lead doit rappeler vite.
 */
router.post('/:slug', validateSlug, async (req, res, next) => {
  try {
    const site = await repo.sites.findBySlug(req.params.slug);
    if (!site) return next(Errors.notFound('Site introuvable'));

    const name    = sanitizeInput(req.body.name    ?? '', 100);
    const phone   = sanitizeInput(req.body.phone   ?? '', 30);
    const email   = sanitizeInput(req.body.email   ?? '', 100);
    const message = sanitizeInput(req.body.message ?? '', 500);

    if (!name || (!phone && !email)) {
      return next(Errors.badRequest('Nom et au moins un moyen de contact (téléphone ou email) requis'));
    }

    await repo.events.track({
      type:   EVENT_TYPES.CONTACT_FORM,
      siteId: site.id,
      leadId: site.lead_id,
      userId: site.user_id,
      meta:   { name, phone, email, message },
    });

    // Un formulaire rempli = intention déclarée : la séquence froide s'arrête
    // (envoyer "Dernier message" à qui demande à être rappelé brûlerait le deal)
    // et le lead passe en "à rappeler" (sans écraser un statut final manuel).
    await markContactFollowup(site.lead_id);

    logger.info('[Contact] Formulaire soumis 🎯 — séquence stoppée, lead → rappeler', { slug: site.slug, from: name });
    res.status(201).json({ success: true, data: { received: true } });

    // Notification au propriétaire — après la réponse, jamais bloquant
    setImmediate(async () => {
      const lead = await repo.leads.findById(site.lead_id);
      notifyHotLead({
        userId:   site.user_id,
        site:     { slug: site.slug, url: site.url },
        leadId:   site.lead_id, // pour les liens d'action CRM en un clic
        leadName: lead?.name ?? site.slug,
        contact:  { name, phone, email, message },
      });
    });
  } catch (err) {
    next(err);
  }
});

export default router;
