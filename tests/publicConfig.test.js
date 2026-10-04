/**
 * Configuration publique (sans connexion) : seulement des drapeaux d'affichage.
 * Le bandeau « version de démonstration » en dépend sur les pages publiques.
 */
import { beforeAll, afterEach, describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/api/index.js';
import { runMigrations } from '../src/db/database.js';
import { config } from '../src/config/config.js';

let app;
const initial = config.showcase.enabled;
beforeAll(() => { runMigrations(); app = createApp(); });
afterEach(() => { config.showcase.enabled = initial; });

describe('GET /public-config', () => {
  it('accessible sans connexion, mode vitrine désactivé par défaut', async () => {
    const res = await request(app).get('/public-config');
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ showcase: false });
  });

  it('reflète SHOWCASE_MODE, sans rien exposer d\'autre', async () => {
    config.showcase.enabled = true;
    const res = await request(app).get('/public-config');
    expect(res.body.data).toEqual({ showcase: true });
  });
});
