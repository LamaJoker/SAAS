/**
 * Formulaire de contact des démos : public, chaque envoi notifie le client
 * par email et fait passer le lead en « à rappeler ». Plafond par IP.
 */
import { beforeAll, describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/api/index.js';
import { runMigrations } from '../src/db/database.js';
import { config } from '../src/config/config.js';

let app;
beforeAll(() => { runMigrations(); app = createApp(); });

describe('formulaire de contact — plafond par IP', () => {
  it('accepte les envois légitimes puis refuse au-delà du plafond, toutes démos confondues', async () => {
    const agent = request.agent(app);
    await agent.post('/users/register').send({ email: `ct-${Date.now()}@test.fr`, password: 'Password1234' });
    const slugs = [];
    for (const name of ['Fleuriste Rose', 'Fleuriste Lys']) {
      const lead = await agent.post('/leads').send({ name, activity: 'fleuriste', city: 'Besançon' });
      slugs.push((await agent.post('/generate').send({ leadId: lead.body.data.id })).body.data.slug);
    }

    const statuses = [];
    for (let i = 0; i <= config.rateLimit.contactMax; i++) {
      const slug = slugs[i % slugs.length]; // un bot balaie plusieurs démos
      statuses.push((await request(app).post(`/contact/${slug}`).send({ name: 'Bot', email: 'bot@spam.test' })).status);
    }
    expect(statuses.slice(0, -1).every(s => s === 201)).toBe(true);
    expect(statuses.at(-1)).toBe(429);
  });
});
