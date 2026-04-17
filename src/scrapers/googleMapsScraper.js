/**
 * googleMapsScraper.js — Scraping Google Maps sans API (coût = 0€)
 *
 * Utilise Playwright pour scraper les résultats Google Maps.
 * Alternative : puppeteer (même logique).
 *
 * Installation : npm install playwright
 *                npx playwright install chromium
 *
 * ⚠️ Usage éthique : respecter robots.txt, ne pas surcharger, ajouter délais.
 *
 * Retourne : [{ name, address, phone, website, category, rating, city }]
 */

import { chromium }  from 'playwright';
import { logger }    from '../utils/logger.js';
import { getDb }     from '../db/database.js';
import { slugify }   from '../utils/utils.js';

// ─── Config ───────────────────────────────────────────────────────────────────
const SCROLL_COUNT     = 8;    // nombre de scrolls dans la liste (20 résultats/scroll)
const DELAY_BETWEEN_MS = 1500; // délai entre actions (anti-détection)
const HEADLESS         = process.env.SCRAPER_HEADLESS !== 'false';

// ─── Helpers ──────────────────────────────────────────────────────────────────
const sleep = ms => new Promise(r => setTimeout(r, ms + Math.random() * 500));

function hasWebsite(result) {
  return !!result.website && result.website !== '';
}

// ─── Déduplication ────────────────────────────────────────────────────────────
function isAlreadyScraped(phone, name, city) {
  const db = getDb();
  try {
    const existing = db.prepare(`
      SELECT id FROM leads
      WHERE (phone = ? AND phone IS NOT NULL AND phone != '')
         OR (name = ? AND city = ?)
      LIMIT 1
    `).get(phone || '__no_phone__', name, city);
    return !!existing;
  } catch {
    return false;
  }
}

// ─── Main scraper ─────────────────────────────────────────────────────────────
/**
 * Scrape Google Maps pour une activité dans une ville.
 * @param {string} activity - ex: "plombier"
 * @param {string} city - ex: "Lyon"
 * @param {object} opts
 * @param {boolean} opts.filterNoWebsite - garder uniquement sans site web
 * @param {number} opts.maxResults - limite de résultats
 */
export async function scrapeGoogleMaps(activity, city, opts = {}) {
  const { filterNoWebsite = true, maxResults = 50 } = opts;

  const query   = `${activity} ${city}`;
  const results = [];

  logger.info(`[Scraper] Starting: "${query}" (headless=${HEADLESS})`);

  let browser;
  try {
    browser = await chromium.launch({
      headless: HEADLESS,
      args: [
        '--no-sandbox',
        '--disable-blink-features=AutomationControlled',
        '--disable-web-security',
      ],
    });

    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      viewport: { width: 1280, height: 900 },
      locale: 'fr-FR',
    });

    const page = await context.newPage();

    // Navigation vers Google Maps
    const url = `https://www.google.com/maps/search/${encodeURIComponent(query)}`;
    await page.goto(url, { waitUntil: 'networkidle', timeout: 30_000 });
    await sleep(DELAY_BETWEEN_MS);

    // Accepter les cookies si présents
    try {
      const acceptBtn = page.locator('button:has-text("Tout accepter"), button:has-text("Accept all")');
      if (await acceptBtn.count() > 0) {
        await acceptBtn.first().click();
        await sleep(1000);
      }
    } catch {}

    // Scroll dans la liste pour charger plus de résultats
    const listSelector = '[role="feed"]';
    try {
      await page.waitForSelector(listSelector, { timeout: 10_000 });

      for (let i = 0; i < SCROLL_COUNT; i++) {
        await page.evaluate((sel) => {
          const el = document.querySelector(sel);
          if (el) el.scrollBy(0, 2000);
        }, listSelector);
        await sleep(DELAY_BETWEEN_MS);
      }
    } catch {
      logger.warn('[Scraper] Feed selector not found, trying alternative');
    }

    // Récupérer tous les éléments de résultats
    const items = await page.locator('a[href*="/maps/place/"]').all();
    logger.info(`[Scraper] Found ${items.length} items for "${query}"`);

    for (const item of items.slice(0, maxResults * 2)) {
      if (results.length >= maxResults) break;

      try {
        // Cliquer sur l'item pour voir les détails
        await item.click();
        await sleep(DELAY_BETWEEN_MS);

        // Attendre le panneau de détails
        await page.waitForSelector('h1', { timeout: 5_000 });

        // Extraire les données
        const data = await page.evaluate(() => {
          const getText = (selectors) => {
            for (const sel of selectors) {
              const el = document.querySelector(sel);
              if (el?.textContent?.trim()) return el.textContent.trim();
            }
            return '';
          };

          const getAttr = (selectors, attr) => {
            for (const sel of selectors) {
              const el = document.querySelector(sel);
              if (el?.getAttribute(attr)) return el.getAttribute(attr);
            }
            return '';
          };

          const name    = getText(['h1', '[data-item-id="name"]']);
          const address = getText(['[data-item-id="address"]', 'button[data-item-id="address"]']);
          const phone   = getText(['[data-item-id="phone:tel:"]', 'button[data-item-id*="phone"]']);
          const website = getAttr(['a[data-item-id="authority"]', 'a[aria-label*="site"]'], 'href');
          const rating  = getText(['[aria-label*="étoiles"]', '[aria-label*="stars"]']);
          const category= getText(['button[jsaction*="category"]', '.DkEaL']);

          return { name, address, phone, website, rating, category };
        });

        if (!data.name) continue;
        if (filterNoWebsite && hasWebsite(data)) continue;
        if (isAlreadyScraped(data.phone, data.name, city)) {
          logger.debug(`[Scraper] Duplicate skipped: ${data.name}`);
          continue;
        }

        results.push({
          name:     data.name,
          address:  data.address,
          phone:    data.phone?.replace(/\s/g, '').replace(/^0/, '+33'),
          website:  data.website,
          rating:   parseFloat(data.rating) || null,
          category: data.category || activity,
          city,
          activity,
          scrapedAt: new Date().toISOString(),
        });

        logger.debug(`[Scraper] +1 ${data.name} (${data.phone || 'no phone'})`);

      } catch (err) {
        logger.debug(`[Scraper] Item error: ${err.message}`);
      }
    }

    logger.info(`[Scraper] Done: ${results.length} leads for "${query}"`);
    return results;

  } finally {
    if (browser) await browser.close();
  }
}

// ─── Batch scraping ───────────────────────────────────────────────────────────
/**
 * Scrape plusieurs activités / villes en séquence.
 * @param {Array<{activity: string, city: string}>} targets
 * @param {Function} onResult - callback appelé pour chaque lead trouvé
 */
export async function scrapeBatch(targets, onResult, opts = {}) {
  const stats = { total: 0, skipped: 0, errors: 0 };

  for (const { activity, city } of targets) {
    try {
      const results = await scrapeGoogleMaps(activity, city, opts);
      for (const r of results) {
        await onResult(r);
        stats.total++;
      }
      // Pause entre les recherches (anti-détection)
      await sleep(3000 + Math.random() * 2000);
    } catch (err) {
      logger.error(`[Scraper] Batch error for "${activity} ${city}": ${err.message}`);
      stats.errors++;
    }
  }

  return stats;
}

// ─── Targets prédéfinis (haute valeur) ───────────────────────────────────────
export const HIGH_VALUE_TARGETS = [
  'plombier', 'électricien', 'couvreur', 'maçon', 'menuisier',
  'carreleur', 'peintre en bâtiment', 'serrurier', 'chauffagiste',
  'garagiste', 'mécanicien auto', 'carrossier',
  'dentiste', 'médecin généraliste', 'kinésithérapeute',
  'avocat', 'expert-comptable', 'notaire',
  'agence immobilière', 'architecte', 'géomètre',
];
