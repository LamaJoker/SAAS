import express from 'express';
import { readFileSync, existsSync } from 'fs';
import { join }          from 'path';
import { repo }          from '../../db/repo.js';
import { validateSlug }  from '../middleware/validate.js';
import { Errors }        from '../../utils/AppError.js';
import { logger }        from '../../utils/logger.js';
import { config }        from '../../config/config.js';

const router = express.Router();

router.get('/:slug', validateSlug, async (req, res, next) => {
  try {
    const site = await repo.sites.findBySlug(req.params.slug);
    if (!site) return next(Errors.notFound('Site introuvable'));

    // Chemin canonique reconstruit depuis le slug (validé [a-z0-9-]) :
    // indépendant du cwd au moment de la génération
    const filePath = join(config.paths.output, site.slug, 'index.html');

    if (!existsSync(filePath)) {
      logger.warn('[Demo] Fichier manquant', { slug: req.params.slug, path: filePath });
      return next(Errors.notFound('Fichier de démo introuvable'));
    }

    await repo.sites.incrementViews(site.id);

    const html = readFileSync(filePath, 'utf-8');
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=3600');
    // Défense en profondeur : le HTML contient du contenu scrapé/saisi par des tiers.
    // Même si sanitize() échouait, aucun script externe ni exfiltration possible.
    res.setHeader('Content-Security-Policy', [
      "default-src 'none'",
      "style-src 'unsafe-inline' https://fonts.googleapis.com",
      "font-src https://fonts.gstatic.com",
      "img-src 'self' data: https:",
      "script-src 'unsafe-inline'",
      "connect-src 'self'",
      "form-action 'self'",
      "base-uri 'none'",
      "frame-ancestors 'none'",
    ].join('; '));
    res.send(html);
  } catch (err) {
    next(err);
  }
});

export default router;
