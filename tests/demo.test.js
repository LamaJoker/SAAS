/**
 * demo.test.js — Route publique /demos/:slug.
 *
 * C'est la page que voit le prospect : la seule de tout le produit dont
 * l'indisponibilité se traduit directement en vente perdue. Elle n'avait
 * aucun test.
 *
 * Couvre les quatre comportements qui comptent :
 *   - la page est servie, avec ses en-têtes de sécurité
 *   - la vue est comptée (signal de conversion), APRÈS l'envoi de la réponse
 *   - un slug inconnu répond 404 sans fuiter d'information
 *   - un site présent en base mais dont le fichier a disparu répond 404 et ne
 *     fait pas tomber le process (purge, restauration partielle, volume non
 *     monté : le cas arrive en vrai)
 */
import { beforeAll, describe, it, expect } from 'vitest';
import request from 'supertest';
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { createApp } from '../src/api/index.js';
import { runMigrations, getDb } from '../src/db/database.js';
import { config } from '../src/config/config.js';

let app;
beforeAll(() => { runMigrations(); app = createApp(); });

const PW = 'Password1234';
const email = (p) => `${p}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}@test.fr`;

/** Crée un compte vérifié et génère un site ; renvoie son slug. */
async function generatedSite(prefix) {
  const agent = request.agent(app);
  const reg = await agent.post('/users/register').send({ email: email(prefix), password: PW });
  expect(reg.status).toBe(201);

  const lead = await agent.post('/leads')
    .send({ name: 'Plomberie Martin', activity: 'plombier', city: 'Besançon' });
  expect(lead.status).toBe(201);

  const gen = await agent.post('/generate').send({ leadId: lead.body.data.id });
  expect(gen.status).toBe(201);
  expect(gen.body.data.slug).toBeTruthy();
  return gen.body.data.slug;
}

const viewsOf = (slug) => getDb().prepare('SELECT views FROM sites WHERE slug = ?').get(slug)?.views;

describe('GET /demos/:slug', () => {
  it('sert la démo en HTML avec ses en-têtes de sécurité', async () => {
    const slug = await generatedSite('demo-ok');
    const res = await request(app).get(`/demos/${slug}`);

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/html/);
    expect(res.text).toContain('Plomberie Martin');

    // Le HTML embarque du contenu tiers : la CSP doit rester verrouillée.
    expect(res.headers['content-security-policy']).toContain("default-src 'none'");
    expect(res.headers['content-security-policy']).toContain("frame-ancestors 'none'");

    // Démo non sollicitée par l'entreprise : jamais indexée.
    expect(res.headers['x-robots-tag']).toMatch(/noindex/);
  });

  it('compte la vue (signal de conversion)', async () => {
    const slug = await generatedSite('demo-views');
    expect(viewsOf(slug)).toBe(0);

    await request(app).get(`/demos/${slug}`);
    await request(app).get(`/demos/${slug}`);

    // L'incrément part après l'envoi de la réponse : on laisse un tick au
    // callback de sendFile avant de lire le compteur.
    await new Promise((r) => setTimeout(r, 50));
    expect(viewsOf(slug)).toBe(2);
  });

  it('slug inexistant → 404', async () => {
    const res = await request(app).get('/demos/slug-qui-nexiste-pas');
    expect(res.status).toBe(404);
  });

  it('site en base mais fichier disparu → 404, pas de crash', async () => {
    const slug = await generatedSite('demo-orphan');
    rmSync(join(config.paths.output, slug), { recursive: true, force: true });

    const res = await request(app).get(`/demos/${slug}`);
    expect(res.status).toBe(404);

    // Le compteur ne doit pas bouger : rien n'a été vu.
    await new Promise((r) => setTimeout(r, 50));
    expect(viewsOf(slug)).toBe(0);

    // Le process répond toujours après l'incident.
    expect((await request(app).get('/health')).status).toBe(200);
  });
});
