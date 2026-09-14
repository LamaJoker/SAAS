import express from 'express';
import { repo }         from '../../db/repo.js';
import { leadTimeline } from '../../db/queries.js';
import { Errors }       from '../../utils/AppError.js';
import { validateLead } from '../middleware/validate.js';
import { requireAdmin } from '../middleware/auth.js';
import { eraseProspect } from '../../services/prospectPrivacyService.js';

const router = express.Router();

router.post('/', validateLead, async (req, res, next) => {
  try {
    const { name, activity, city, email, phone } = req.body;
    const lead = await repo.leads.create({ userId: req.userId, name, activity, city, email, phone });
    res.status(201).json({ success: true, data: lead });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /leads/erase — Droit à l'effacement d'un prospect (RGPD art. 17).
 *
 * Admin uniquement : une demande d'effacement arrive par email ou courrier et
 * doit être vérifiée par un humain avant exécution. L'ouvrir en self-service
 * permettrait d'effacer les leads d'un concurrent en connaissant son adresse.
 *
 * Portée volontairement globale (tous comptes) : une entreprise qui demande à
 * disparaître ne va pas répéter sa demande à chacun de vos clients.
 */
router.post('/erase', requireAdmin, async (req, res, next) => {
  try {
    const email = String(req.body?.email ?? '').trim();
    if (!email) return next(Errors.badRequest('email requis'));
    const result = await eraseProspect(email);
    res.json({ success: true, data: result });
  } catch (err) {
    if (err.message === 'Adresse email invalide') return next(Errors.badRequest(err.message));
    next(err);
  }
});

router.get('/', async (req, res, next) => {
  try {
    const limit  = Math.min(200, Math.max(1, parseInt(req.query.limit, 10) || 50));
    const page   = Math.max(1, parseInt(req.query.page, 10) || 1);
    const total  = await repo.leads.countByUser(req.userId);
    const leads  = await repo.leads.findAllByUser(req.userId, { limit, offset: (page - 1) * limit });
    res.json({
      success: true,
      data: leads,
      pagination: { page, limit, total, pages: Math.max(1, Math.ceil(total / limit)) },
    });
  } catch (err) {
    next(err);
  }
});

// Suivi commercial (CRM minimal) : où en est la relation avec ce prospect
const PIPELINE_VALUES = ['nouveau', 'contacte', 'interesse', 'rappeler', 'converti', 'perdu'];

router.patch('/:id', async (req, res, next) => {
  try {
    const updates = {};
    if (req.body.pipeline !== undefined) {
      if (!PIPELINE_VALUES.includes(req.body.pipeline)) {
        return next(Errors.badRequest(`pipeline invalide (valeurs: ${PIPELINE_VALUES.join(', ')})`));
      }
      updates.pipeline = req.body.pipeline;
    }
    if (req.body.note !== undefined) {
      updates.note = String(req.body.note).slice(0, 2000);
    }
    if (!Object.keys(updates).length) {
      return next(Errors.badRequest('Aucun champ à mettre à jour (pipeline, note)'));
    }

    const updated = await repo.leads.updateCrmForUser(req.params.id, req.userId, updates);
    if (!updated) return next(Errors.notFound('Lead introuvable'));
    res.json({ success: true, data: updated });
  } catch (err) {
    next(err);
  }
});

router.get('/:id', async (req, res, next) => {
  try {
    const lead = await repo.leads.findByIdForUser(req.params.id, req.userId);
    if (!lead) return next(Errors.notFound('Lead introuvable'));
    res.json({ success: true, data: lead });
  } catch (err) {
    next(err);
  }
});

/**
 * Timeline d'un prospect : tout ce qui s'est passé, trié du plus récent
 * au plus ancien. À consulter AVANT de décrocher le téléphone.
 */
router.get('/:id/timeline', async (req, res, next) => {
  try {
    const lead = await repo.leads.findByIdForUser(req.params.id, req.userId);
    if (!lead) return next(Errors.notFound('Lead introuvable'));

    const timeline = await leadTimeline(lead.id);
    res.json({ success: true, data: { lead: { id: lead.id, name: lead.name, pipeline: lead.pipeline, note: lead.note }, timeline } });
  } catch (err) {
    next(err);
  }
});

router.delete('/:id', async (req, res, next) => {
  try {
    if (!await repo.leads.deleteByIdForUser(req.params.id, req.userId)) {
      return next(Errors.notFound('Lead introuvable'));
    }
    res.json({ success: true, data: { deleted: true } });
  } catch (err) {
    next(err);
  }
});

export default router;
