import express from 'express';
import { scrapeQueue }   from '../../workers/index.js';
import { sanitizeInput } from '../../utils/utils.js';
import { Errors, AppError } from '../../utils/AppError.js';
import { logger }        from '../../utils/logger.js';

const router = express.Router();

// Un seul scrape Google Maps à la fois par process (Playwright est lourd)
let scrapeInProgress = false;

/**
 * POST /scrape — Lance un scraping Google Maps "activité + ville".
 * Les résultats sont poussés dans la queue scrape (dédup + création lead
 * + génération auto). Nécessite Playwright : npm i playwright && npx playwright install chromium
 *
 * Répond 202 immédiatement : le scraping tourne en arrière-plan,
 * les leads apparaissent au fil de l'eau dans l'onglet Leads.
 */
router.post('/', async (req, res, next) => {
  try {
    const activity = sanitizeInput(req.body.activity ?? '', 100);
    const city     = sanitizeInput(req.body.city     ?? '', 100);
    const limit    = Math.min(60, Math.max(1, parseInt(req.body.limit) || 20));
    const autoGenerate = req.body.autoGenerate !== false;

    if (!activity || !city) {
      return next(Errors.badRequest('activity et city requis'));
    }

    if (scrapeInProgress) {
      return next(Errors.conflict('Un scraping est déjà en cours — réessayez dans quelques minutes'));
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
    scrapeInProgress = true;
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
        scrapeInProgress = false;
      }
    });
  } catch (err) {
    scrapeInProgress = false;
    next(err);
  }
});

router.get('/status', (req, res) => {
  res.json({ success: true, data: { inProgress: scrapeInProgress } });
});

export default router;
