import { createHash } from 'crypto';

export function slugify(str) {
  if (!str || typeof str !== 'string') return '';
  return str
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-');
}

export function sanitize(str) {
  if (!str || typeof str !== 'string') return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');
}

export function sanitizeInput(str, maxLength = 200) {
  if (!str || typeof str !== 'string') return '';
  return str.trim().slice(0, maxLength).replace(/[<>'"]/g, '');
}

export function formatListToHTML(items, className = '') {
  if (!Array.isArray(items) || items.length === 0) return '';
  const classAttr = className ? ` class="${className}"` : '';
  const listItems = items.map(item => `    <li>${sanitize(String(item))}</li>`).join('\n');
  return `<ul${classAttr}>\n${listItems}\n</ul>`;
}

export function generateSlug(lead) {
  const base = slugify([lead.name || '', lead.city || '', 'demo'].filter(Boolean).join(' '));
  const hash = createHash('sha1')
    .update(`${lead.name}-${lead.city}-${lead.id || Date.now()}`)
    .digest('hex')
    .slice(0, 8);
  return `${base}-${hash}`;
}

export function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export async function withRetry(fn, attempts = 2, delay = 1000) {
  let lastError;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (i < attempts - 1) await sleep(delay);
    }
  }
  throw lastError;
}

export function log(level, message) {
  const icons = { info: '[i]', success: '[+]', error: '[!]', warn: '[~]' };
  const icon = icons[level] || '[-]';
  const ts = new Date().toLocaleTimeString('fr-FR');
  const out = `[${ts}] ${icon} ${message}`;
  if (level === 'error') process.stderr.write(out + '\n');
  else process.stdout.write(out + '\n');
}