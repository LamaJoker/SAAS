import express from 'express';
import { readFileSync, existsSync } from 'fs';
import { Site }          from '../../db/models/Site.js';
import { validateSlug }  from '../middleware/validate.js';
import { Errors }        from '../../utils/AppError.js';
import { logger }        from '../../utils/logger.js';

const router = express.Router();

router.get('/:slug', validateSlug, (req, res, next) => {
  try {
    const site = Site.findBySlug(req.params.slug);
    if (!site) return next(Errors.notFound('Site introuvable'));

    if (!existsSync(site.output_path)) {
      logger.warn('[Demo] Fichier manquant', { slug: req.params.slug, path: site.output_path });
      return next(Errors.notFound('Fichier de démo introuvable'));
    }

    Site.incrementViews(site.id);

    const html = readFileSync(site.output_path, 'utf-8');
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.send(html);
  } catch (err) {
    next(err);
  }
});

export default router;
