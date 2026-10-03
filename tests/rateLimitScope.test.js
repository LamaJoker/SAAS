/**
 * Portée de la limite globale : elle protège l'API, pas les fichiers
 * statiques ni la sonde de vie. Sinon un dashboard ouvert (CSS, JS, auto-
 * refresh) et les health checks de l'hébergeur épuisent le quota d'une IP.
 */
import { beforeAll, describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/api/index.js';
import { runMigrations } from '../src/db/database.js';
import { config } from '../src/config/config.js';

let app;
beforeAll(() => { runMigrations(); app = createApp(); });

async function hit(path, n) {
  const statuses = new Set();
  for (let i = 0; i < n; i++) statuses.add((await request(app).get(path)).status);
  return statuses;
}

describe('limite globale — portée', () => {
  const over = config.rateLimit.maxRequests + 20;

  it('les fichiers statiques ne consomment pas le quota', async () => {
    expect(await hit('/styles.css', over)).toEqual(new Set([200]));
  });

  it('la sonde /health n\'est jamais limitée', async () => {
    expect(await hit('/health', over)).toEqual(new Set([200]));
  });

  it('l\'API reste limitée au-delà du quota', async () => {
    const statuses = await hit('/billing/packs', over);
    expect(statuses.has(429)).toBe(true);
  });

  it('la page de connexion reçoit la CSP', async () => {
    const res = await request(app).get('/login');
    expect(res.headers['content-security-policy']).toMatch(/script-src 'self'/);
  });
});
