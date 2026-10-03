/**
 * Actions CRM depuis l'email de notification. Les passerelles de sécurité de
 * messagerie visitent chaque lien avant l'utilisateur : une simple visite (GET)
 * ne doit rien modifier, seule la confirmation (POST) écrit.
 */
import { beforeAll, describe, it, expect } from 'vitest';
import request from 'supertest';
import { randomUUID } from 'crypto';
import { createApp } from '../src/api/index.js';
import { runMigrations, getDb } from '../src/db/database.js';
import { buildCrmToken } from '../src/utils/crmToken.js';

let app;
beforeAll(() => { runMigrations(); app = createApp(); });

function seedLead(name = 'Garage Martin') {
  const db = getDb();
  const userId = randomUUID(), leadId = randomUUID();
  db.prepare('INSERT INTO users (id, email, credits) VALUES (?, ?, 0)').run(userId, `${userId}@test.fr`);
  db.prepare(`INSERT INTO leads (id, user_id, name, activity, city, pipeline)
              VALUES (?, ?, ?, 'garagiste', 'Lyon', 'rappeler')`).run(leadId, userId, name);
  return leadId;
}
const pipelineOf = (id) => getDb().prepare('SELECT pipeline FROM leads WHERE id = ?').get(id).pipeline;

describe('CRM — actions depuis l\'email', () => {
  it('la visite des trois liens (scanner de messagerie) ne modifie rien', async () => {
    const leadId = seedLead();
    for (const action of ['converti', 'contacte', 'perdu']) {
      const res = await request(app).get(`/crm/quick/${buildCrmToken(leadId, action)}`);
      expect(res.status).toBe(200);
      expect(res.text).toMatch(/<form method="post"/);
    }
    expect(pipelineOf(leadId)).toBe('rappeler');
  });

  it('la confirmation applique l\'action', async () => {
    const leadId = seedLead();
    const res = await request(app).post(`/crm/quick/${buildCrmToken(leadId, 'converti')}`);
    expect(res.status).toBe(200);
    expect(pipelineOf(leadId)).toBe('converti');
  });

  it('token altéré : 400 sur la visite comme sur la confirmation', async () => {
    const leadId = seedLead();
    const forged = `${buildCrmToken(leadId, 'perdu').split('.')[0]}.aaaaaaaaaaaaaaaa`;
    expect((await request(app).get(`/crm/quick/${forged}`)).status).toBe(400);
    expect((await request(app).post(`/crm/quick/${forged}`)).status).toBe(400);
    expect(pipelineOf(leadId)).toBe('rappeler');
  });

  it('le nom du prospect est échappé et la page n\'exécute aucun script', async () => {
    const leadId = seedLead('<img src=x onerror=alert(1)>');
    const res = await request(app).get(`/crm/quick/${buildCrmToken(leadId, 'perdu')}`);
    expect(res.text).not.toContain('<img src=x');
    expect(res.text).toContain('&lt;img');
    expect(res.headers['content-security-policy']).toMatch(/default-src 'none'/);
  });
});
