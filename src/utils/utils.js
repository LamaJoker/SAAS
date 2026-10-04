import { createHash } from 'crypto';

export function slugify(str) {
  if (!str || typeof str !== 'string') return '';
  return str.toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s-]/g, '')
    .trim().replace(/\s+/g, '-').replace(/-+/g, '-');
}

export function sanitize(str) {
  if (!str || typeof str !== 'string') return '';
  return str
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');
}

export function sanitizeInput(str, maxLength = 200) {
  if (!str || typeof str !== 'string') return '';
  return str.trim().slice(0, maxLength).replace(/[<>'"]/g, '');
}

export function generateSlug(lead) {
  const base = slugify([lead.name || '', lead.city || '', 'demo'].filter(Boolean).join(' '));
  const hash = createHash('sha1')
    .update(`${lead.name}-${lead.city}-${lead.id || Date.now()}`)
    .digest('hex').slice(0, 8);
  return `${base}-${hash}`;
}

export function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export async function withRetry(fn, attempts = 2, delay = 1000) {
  let lastError;
  for (let i = 0; i < attempts; i++) {
    try { return await fn(); }
    catch (err) {
      lastError = err;
      if (i < attempts - 1) await sleep(delay);
    }
  }
  throw lastError;
}

export function formatListToHTML(items, className = '') {
  if (!Array.isArray(items) || !items.length) return '';
  const attr = className ? ` class="${className}"` : '';
  const lis  = items.map(i => `    <li>${sanitize(String(i))}</li>`).join('\n');
  return `<ul${attr}>\n${lis}\n</ul>`;
}

/**
 * Date lue en base → Date. SQLite écrit `datetime('now')` en UTC SANS fuseau
 * (« 2026-10-03 18:00:00 ») ; `new Date()` lit ce format comme une heure
 * LOCALE. Sur un serveur hors UTC (VPS réglé sur Europe/Paris, cf. le service
 * systemd fourni), toute comparaison avec maintenant était décalée de
 * l'offset : invalidation de sessions, filtre d'ouvertures automatiques,
 * scoring, cadence d'envoi. Les ISO complets (avec Z ou offset) passent tels quels.
 */
const SQLITE_DATETIME_RE = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(\.\d+)?$/;

export function parseDbDate(value) {
  if (value instanceof Date) return value;
  if (typeof value === 'string' && SQLITE_DATETIME_RE.test(value)) {
    return new Date(`${value.replace(' ', 'T')}Z`);
  }
  return new Date(value);
}
