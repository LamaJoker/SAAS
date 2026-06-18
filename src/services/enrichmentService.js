/**
 * enrichmentService.js — Trouve un email pour un lead qui n'en a pas.
 *
 * Activable via ENRICHMENT_ENABLED. Deux providers :
 *   - 'website' : si le lead a un site, on récupère sa home + /contact et on
 *                 extrait les emails (mailto: et texte). Gratuit, sans dépendance.
 *   - 'api'     : appel d'un fournisseur d'enrichissement HTTP configuré
 *                 (ENRICHMENT_API_URL + ENRICHMENT_API_KEY).
 *
 * Toujours non bloquant : un échec renvoie { email: null }.
 */
import { config } from '../config/config.js';
import { logger } from '../utils/logger.js';

const EMAIL_RE = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi;
// Emails poubelle à ignorer (images, exemples, placeholders)
const JUNK_RE  = /\.(png|jpe?g|gif|webp|svg)$|@(example|sentry|wix|domain)\.|@2x|noreply|no-reply/i;

/**
 * Extrait le premier email plausible d'un contenu HTML/texte.
 * Exporté pour les tests.
 */
export function extractEmail(html) {
  if (typeof html !== 'string') return null;
  const matches = html.match(EMAIL_RE);
  if (!matches) return null;
  for (const raw of matches) {
    const email = raw.toLowerCase();
    if (!JUNK_RE.test(email) && email.length <= 254) return email;
  }
  return null;
}

async function fetchText(url, timeoutMs = 8000) {
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(timeoutMs),
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; AutoDemoBot/1.0)' },
      redirect: 'follow',
    });
    if (!res.ok) return '';
    return await res.text();
  } catch {
    return '';
  }
}

async function fromWebsite(lead) {
  if (!lead.website) return null;
  let base = lead.website.trim();
  if (!/^https?:\/\//i.test(base)) base = 'https://' + base;

  // Home puis /contact (les emails y sont le plus souvent)
  for (const path of ['', '/contact', '/contactez-nous', '/mentions-legales']) {
    const html  = await fetchText(base.replace(/\/+$/, '') + path);
    const email = extractEmail(html);
    if (email) return email;
  }
  return null;
}

async function fromApi(lead) {
  if (!config.features.enrichment.apiUrl || !config.features.enrichment.apiKey) return null;
  try {
    const res = await fetch(config.features.enrichment.apiUrl, {
      method: 'POST',
      signal: AbortSignal.timeout(10_000),
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.features.enrichment.apiKey}`,
      },
      body: JSON.stringify({ name: lead.name, city: lead.city, activity: lead.activity, website: lead.website }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    return extractEmail(data?.email || '') || (data?.email ?? null);
  } catch (err) {
    logger.warn('[Enrichment] API échouée', { error: err.message });
    return null;
  }
}

/**
 * @returns {Promise<{ email: string|null, source: string|null }>}
 */
export async function enrichLeadEmail(lead) {
  if (!config.features.enrichment.enabled) return { email: null, source: null };
  if (lead.email) return { email: lead.email, source: 'provided' };

  const provider = config.features.enrichment.provider;
  let email = null;

  if (provider === 'website') email = await fromWebsite(lead);
  else if (provider === 'api') email = await fromApi(lead);

  if (email) logger.info('[Enrichment] Email trouvé', { name: lead.name, provider });
  return { email, source: email ? provider : null };
}

export function isEnrichmentActive() {
  return config.features.enrichment.enabled;
}
