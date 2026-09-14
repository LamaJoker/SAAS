import express from 'express';
import { scrapeQueue }   from '../../workers/index.js';
import { sanitizeInput } from '../../utils/utils.js';
import { Errors, AppError } from '../../utils/AppError.js';
import { logger }        from '../../utils/logger.js';

const router = express.Router();

/**
 * Verrou de scraping.
 *
 * Avant : un booléen global. Le scrape d'un compte renvoyait donc 409 à TOUS
 * les autres — « Un scraping est déjà en cours » alors que l'utilisateur n'en
 * avait lancé aucun. Défaut d'isolation multi-tenant, invisible en solo,
 * bloquant dès le deuxième client.
 *
 * Après : un verrou par compte (un utilisateur ne se double pas lui-même) plus
 * un plafond global, parce que la vraie contrainte est la mémoire : chaque
 * scrape lance un Chromium.
 */
const inProgress = new Set();
const MAX_CONCURRENT = Math.max(1, parseInt(process.env.SCRAPE_MAX_CONCURRENT ?? '2', 10));

/**
 * POST /scrape — Lance un scraping Google Maps "activité + ville".
 * Les résultats sont poussés dans la queue scrape (dédup + création lead
 * + génération auto). Nécessite Playwright : npm i playwright && npx playwright install chromium
 *
 * Répond 202 immédiatement : le scraping tourne en arrière-plan,
 * les leads apparaissent au fil de l'eau dans l'onglet Leads.
 */
router.post('/', async (req, res, next) => {
  let locked = false;
  try {
    const activity = sanitizeInput(req.body.activity ?? '', 100);
    const city     = sanitizeInput(req.body.city     ?? '', 100);
    const limit    = Math.min(60, Math.max(1, parseInt(req.body.limit) || 20));
    const autoGenerate = req.body.autoGenerate !== false;

    if (!activity || !city) {
      return next(Errors.badRequest('activity et city requis'));
    }

    if (inProgress.has(req.userId)) {
      return next(Errors.conflict('Un scraping est déjà en cours sur votre compte — réessayez dans quelques minutes'));
    }
    if (inProgress.size >= MAX_CONCURRENT) {
      return next(Errors.conflict('Trop de scrapings simultanés sur le serveur — réessayez dans quelques minutes'));
    }

    // Playwright est optionnel : import paresseux pour ne pas casser le boot
    let scraperModule;
    try {
      scraperModule = await import('../../scrapers/googleMapsScraper.js');
    } catch (err) {
      logger.warn('[Scrape] Playwright indisponible', { error: err.message });
      return next(new AppError(
        'Scraper indisponible : installez Playwright (npm i playwright && npx playwright install chromium)',
        503, 'SCRAPER_UNAVAILABLE'
      ));
    }

    const userId = req.userId;
    inProgress.add(userId);
    locked = true;
    res.status(202).json({
      success: true,
      data: {
        started: true,
        message: `Scraping "${activity}" à ${city} lancé — les leads apparaîtront dans l'onglet Leads au fil de l'eau`,
      },
    });

    // Travail en arrière-plan après la réponse
    setImmediate(async () => {
      try {
        const results = await scraperModule.scrapeGoogleMaps(activity, city, { maxResults: limit });
        let queued = 0;
        for (const r of results) {
          // On ne prospecte que les entreprises SANS site web (cœur du business)
          if (r.website) continue;
          scrapeQueue.add({
            userId,
            name:     r.name,
            activity: r.category || activity,
            city:     r.city     || city,
            email:    r.email ?? null,
            phone:    r.phone ?? null,
            autoGenerate,
          });
          queued++;
        }
        logger.info('[Scrape] Terminé', { activity, city, found: results.length, queued });
      } catch (err) {
        logger.error('[Scrape] Échec', { activity, city, error: err.message });
      } finally {
        inProgress.delete(userId);
      }
    });
  } catch (err) {
    // Ne libère que si CETTE requête avait pris le verrou : sinon une erreur de
    // validation libérerait le scrape d'une autre requête du même compte.
    if (req.userId && locked) inProgress.delete(req.userId);
    next(err);
  }
});

router.get('/status', (req, res) => {
  res.json({
    success: true,
    data: {
      inProgress: inProgress.has(req.userId),   // le sien, pas celui des autres
      serverBusy: inProgress.size >= MAX_CONCURRENT,
    },
  });
});

export default router;
