import express from 'express';
import { repo }   from '../../db/repo.js';
import { Errors } from '../../utils/AppError.js';
import { generateContent } from '../../services/aiService.js';
import { buildSite }       from '../../services/siteBuilder.js';
import { withRetry }       from '../../utils/utils.js';
import { config }          from '../../config/config.js';
import { logger }          from '../../utils/logger.js';

const router = express.Router();

router.get('/', async (req, res, next) => {
  try {
    const sites = await repo.sites.findAllByUser(req.userId);
    res.json({ success: true, data: sites });
  } catch (err) {
    next(err);
  }
});

router.get('/credits', async (req, res, next) => {
  try {
    const user = await repo.users.findById(req.userId);
    if (!user) return next(Errors.unauthorized());
    res.json({ success: true, data: { credits: user.credits } });
  } catch (err) {
    next(err);
  }
});

// Régénère le contenu d'un site existant — gratuit (le crédit a déjà été payé).
// Utile quand l'IA a produit un contenu générique ou raté.
router.post('/:id/regenerate', async (req, res, next) => {
  try {
    const site = await repo.sites.findByIdForUser(req.params.id, req.userId);
    if (!site) return next(Errors.notFound('Site introuvable'));

    const lead = await repo.leads.findById(site.lead_id);
    if (!lead) return next(Errors.notFound('Lead associé introuvable'));

    const content = await withRetry(
      () => generateContent(lead),
      config.generation.retryAttempts,
      config.generation.retryDelay
    );
    await buildSite({ lead, content, slug: site.slug, templateId: site.template });

    logger.info('[Sites] Site régénéré', { siteId: site.id, slug: site.slug, userId: req.userId });
    res.json({ success: true, data: { regenerated: true, url: site.url } });
  } catch (err) {
    next(err);
  }
});

router.get('/:id', async (req, res, next) => {
  try {
    const site = await repo.sites.findByIdForUser(req.params.id, req.userId);
    if (!site) return next(Errors.notFound('Site introuvable'));
    res.json({ success: true, data: site });
  } catch (err) {
    next(err);
  }
});

export default router;
