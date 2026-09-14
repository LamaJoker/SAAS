/**
 * demos.js — Sert les sites démo générés.
 *
 * C'est la route publique la plus trafiquée du produit (un prospect par email
 * envoyé). Deux règles y sont tenues strictement :
 *
 *   1. AUCUNE I/O synchrone. `res.sendFile()` streame le fichier sans bloquer
 *      la boucle d'événements. `existsSync` + `readFileSync` bloquaient le
 *      process ENTIER à chaque vue : pendant ce temps, aucune autre requête
 *      — API, dashboard, webhook Stripe — n'était traitée.
 *
 *   2. Effet de bord non bloquant. Le compteur de vues est incrémenté APRÈS
 *      l'envoi de la réponse. Une écriture SQLite ne doit jamais s'insérer
 *      dans la latence perçue par le prospect, et son échec ne doit jamais
 *      empêcher l'affichage de la démo.
 */
import express from 'express';
import { join } from 'path';
import { repo } from '../../db/repo.js';
import { validateSlug } from '../middleware/validate.js';
import { Errors } from '../../utils/AppError.js';
import { logger } from '../../utils/logger.js';
import { config } from '../../config/config.js';

const router = express.Router();

/**
 * Défense en profondeur : le HTML contient du contenu scrapé ou saisi par des
 * tiers. Même si sanitize() échouait, aucun script externe ni exfiltration
 * n'est possible depuis la page.
 */
const DEMO_CSP = [
  "default-src 'none'",
  "style-src 'unsafe-inline' https://fonts.googleapis.com",
  "font-src https://fonts.gstatic.com",
  "img-src 'self' data: https:",
  "script-src 'unsafe-inline'",
  "connect-src 'self'",
  "form-action 'self'",
  "base-uri 'none'",
  "frame-ancestors 'none'",
].join('; ');

router.get('/:slug', validateSlug, async (req, res, next) => {
  try {
    const site = await repo.sites.findBySlug(req.params.slug);
    if (!site) return next(Errors.notFound('Site introuvable'));

    // Chemin canonique reconstruit depuis le slug (validé [a-z0-9-] par le
    // middleware) : indépendant du cwd au moment de la génération.
    const filePath = join(config.paths.output, site.slug, 'index.html');

    // Posés AVANT sendFile : le module `send` ne remplace jamais un en-tête
    // déjà défini, nos valeurs l'emportent donc sur ses valeurs par défaut.
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.setHeader('Content-Security-Policy', DEMO_CSP);
    // La démo n'a pas été sollicitée par l'entreprise concernée : elle ne doit
    // ni être indexée, ni concurrencer son propre référencement.
    res.setHeader('X-Robots-Tag', 'noindex, nofollow');

    res.sendFile(filePath, (err) => {
      if (err) {
        // Rien n'est encore parti : on peut répondre proprement.
        // Cas typique : site en base mais fichier absent (purge, restauration
        // partielle, volume Docker non monté).
        if (!res.headersSent) {
          logger.warn('[Demo] Fichier introuvable', {
            slug: site.slug, path: filePath, code: err.code,
          });
          return next(Errors.notFound('Fichier de démo introuvable'));
        }
        // Transfert interrompu en cours de route (client parti) : plus rien à
        // dire au client, on ferme et on trace.
        logger.warn('[Demo] Envoi interrompu', { slug: site.slug, code: err.code });
        return res.end();
      }

      // Réponse déjà partie : cette écriture ne coûte rien au visiteur.
      repo.sites.incrementViews(site.id).catch((e) =>
        logger.error('[Demo] Incrément des vues échoué', {
          slug: site.slug, error: e.message,
        })
      );
    });
  } catch (err) {
    next(err);
  }
});

export default router;
