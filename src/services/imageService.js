/**
 * imageService.js — Visuels des sites démo (activable par provider).
 *
 * DEMO_IMAGES_PROVIDER :
 *   - 'none'        : aucune image (défaut) — les blocs image disparaissent.
 *   - 'loremflickr' : images par mot-clé d'activité, sans clé API, stables par
 *                     site (paramètre lock dérivé du slug).
 *
 * Les URLs sont en https → autorisées par la CSP des démos (img-src https:).
 */
import { config } from '../config/config.js';

function seedFromSlug(slug) {
  let h = 0;
  for (let i = 0; i < String(slug).length; i++) h = (h * 31 + slug.charCodeAt(i)) % 100000;
  return h;
}

/**
 * @returns {{ heroImage: string, gallery: string[] }}
 */
export function demoImages(lead, slug) {
  const provider = config.features.demoImages.provider;

  if (provider === 'loremflickr') {
    const keyword = encodeURIComponent((lead.activity || 'business').trim().split(/\s+/)[0].toLowerCase());
    const seed = seedFromSlug(slug);
    const url = (n) => `https://loremflickr.com/800/600/${keyword}?lock=${seed + n}`;
    return { heroImage: url(0), gallery: [url(1), url(2), url(3)] };
  }

  return { heroImage: '', gallery: [] };
}

export function isDemoImagesActive() {
  return config.features.demoImages.provider !== 'none';
}
