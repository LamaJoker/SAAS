/**
 * La régénération est gratuite pour l'utilisateur mais chaque appel coûte un
 * appel au modèle : elle partage le quota horaire de la génération.
 */
import { beforeAll, describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/api/index.js';
import { runMigrations, getDb } from '../src/db/database.js';
import { config } from '../src/config/config.js';

let app;
beforeAll(() => { runMigrations(); app = createApp(); });

async function userWithSite() {
  const agent = request.agent(app);
  const reg  = await agent.post('/users/register').send({ email: `regen-${Date.now()}-${Math.random()}@test.fr`, password: 'Password1234' });
  const lead = await agent.post('/leads').send({ name: 'Boulangerie Petit', activity: 'boulanger', city: 'Dijon' });
  const site = await agent.post('/generate').send({ leadId: lead.body.data.id });
  return { agent, userId: reg.body.data.user.id, siteId: site.body.data.id };
}

describe('régénération — garde-fous de coût', () => {
  it('partage le quota horaire de la génération', async () => {
    const { agent, siteId } = await userWithSite(); // 1 génération déjà consommée
    const statuses = [];
    for (let i = 0; i < config.rateLimit.generateMax; i++) {
      statuses.push((await agent.post(`/sites/${siteId}/regenerate`)).status);
    }
    expect(statuses.filter(s => s === 200)).toHaveLength(config.rateLimit.generateMax - 1);
    expect(statuses.at(-1)).toBe(429);
  });

  it('exige une adresse email vérifiée', async () => {
    const { agent, userId, siteId } = await userWithSite();
    getDb().prepare('UPDATE users SET email_verified = 0 WHERE id = ?').run(userId);
    expect((await agent.post(`/sites/${siteId}/regenerate`)).status).toBe(403);
  });
});
