/**
 * Un lead = un site. La démo d'un lead est envoyée au prospect par email :
 * aucune action ultérieure (double-clic, nouvelle tentative, job rejoué,
 * requêtes simultanées) ne doit pouvoir la supprimer ni débiter deux fois.
 */
import { beforeAll, describe, it, expect } from 'vitest';
import request from 'supertest';
import { existsSync, readdirSync } from 'fs';
import { join } from 'path';
import { createApp } from '../src/api/index.js';
import { runMigrations, getDb } from '../src/db/database.js';
import { config } from '../src/config/config.js';
import { generateHandler } from '../src/workers/generateWorker.js';

let app;
beforeAll(() => { runMigrations(); app = createApp(); });

const uniq = () => `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;

async function userWithLead() {
  const agent = request.agent(app);
  const reg = await agent.post('/users/register').send({ email: `gen-${uniq()}@test.fr`, password: 'Password1234' });
  const lead = await agent.post('/leads').send({ name: `Plomberie ${uniq()}`, activity: 'plombier', city: 'Lyon' });
  return { agent, userId: reg.body.data.user.id, leadId: lead.body.data.id };
}

describe('génération — un lead, un site', () => {
  it('une seconde génération répond 409 et laisse la démo publiée intacte', async () => {
    const { agent, leadId } = await userWithLead();
    const first = await agent.post('/generate').send({ leadId });
    expect(first.status).toBe(201);
    const { slug } = first.body.data;

    const second = await agent.post('/generate').send({ leadId });
    expect(second.status).toBe(409);
    expect(second.body.code).toBe('ALREADY_GENERATED');

    expect(existsSync(join(config.paths.output, slug, 'index.html'))).toBe(true);
    expect((await request(app).get(`/demos/${slug}`)).status).toBe(200);
    expect((await agent.get('/sites/credits')).body.data.credits).toBe(9);
    expect((await agent.get(`/leads/${leadId}`)).body.data.status).toBe('done');
  });

  it('deux requêtes simultanées : un seul site, un seul crédit, démo servie', async () => {
    const { agent, leadId } = await userWithLead();
    const results = await Promise.all([
      agent.post('/generate').send({ leadId }),
      agent.post('/generate').send({ leadId }),
    ]);
    const statuses = results.map(r => r.status).sort();
    expect(statuses).toEqual([201, 409]);

    const created = results.find(r => r.status === 201).body.data;
    const count = getDb().prepare('SELECT COUNT(*) AS n FROM sites WHERE lead_id = ?').get(leadId).n;
    expect(count).toBe(1);
    expect((await request(app).get(`/demos/${created.slug}`)).status).toBe(200);
    expect((await agent.get('/sites/credits')).body.data.credits).toBe(9);

    // Aucun fichier temporaire laissé derrière par le build perdant
    const leftovers = readdirSync(join(config.paths.output, created.slug)).filter(f => f.endsWith('.tmp'));
    expect(leftovers).toEqual([]);
  });

  it('le worker traite un job rejoué comme déjà accompli, sans erreur', async () => {
    const { agent, userId, leadId } = await userWithLead();
    expect((await agent.post('/generate').send({ leadId })).status).toBe(201);

    const result = await generateHandler({ data: { leadId, userId } });
    expect(result).toEqual({ skipped: true, reason: 'already_generated' });
  });
});
