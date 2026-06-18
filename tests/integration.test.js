/**
 * Tests d'intégration — exercent l'app Express réelle (supertest) sur une DB
 * temporaire. Couvrent les chemins critiques que les tests unitaires ne voient
 * pas : auth par cookie, isolation multi-tenant, transaction de génération,
 * arrêt de séquence, gating admin, réponses entrantes.
 */
import { beforeAll, describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/api/index.js';
import { runMigrations, getDb } from '../src/db/database.js';

let app;
beforeAll(() => { runMigrations(); app = createApp(); });

const PW = 'Password1234';
const email = (p) => `${p}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}@test.fr`;

// Agent vérifié (SMTP off → compte auto-vérifié) prêt à générer
async function newUser(prefix = 'u') {
  const agent = request.agent(app);
  const e = email(prefix);
  const res = await agent.post('/users/register').send({ email: e, password: PW });
  expect(res.status).toBe(201);
  return { agent, email: e, user: res.body.data.user };
}

describe('auth', () => {
  it('register pose un cookie HttpOnly et n\'expose PAS le token au navigateur', async () => {
    const res = await request(app).post('/users/register').send({ email: email('reg'), password: PW });
    expect(res.status).toBe(201);
    expect(res.headers['set-cookie'][0]).toMatch(/authToken=/);
    expect(res.headers['set-cookie'][0]).toMatch(/HttpOnly/);
    expect(res.body.data.token).toBeUndefined();
    expect(res.body.data.user.email_verified).toBe(true);
  });

  it('expose le token uniquement avec x-auth-mode: token (clients API)', async () => {
    const res = await request(app).post('/users/register')
      .set('x-auth-mode', 'token').send({ email: email('api'), password: PW });
    expect(res.body.data.token).toBeTruthy();
  });

  it('login mauvais mot de passe → 401', async () => {
    const e = email('login');
    await request(app).post('/users/register').send({ email: e, password: PW });
    const res = await request(app).post('/users/login').send({ email: e, password: 'wrong' });
    expect(res.status).toBe(401);
  });

  it('le cookie authentifie /users/me sans en-tête Bearer', async () => {
    const { agent } = await newUser('me');
    const res = await agent.get('/users/me');
    expect(res.status).toBe(200);
  });
});

describe('multi-tenant', () => {
  it('un compte ne peut pas lire le lead d\'un autre', async () => {
    const a = await newUser('tenantA');
    const lead = await a.agent.post('/leads').send({ name: 'Lead A', activity: 'plombier', city: 'Lyon' });
    expect(lead.status).toBe(201);

    const b = await newUser('tenantB');
    const res = await b.agent.get(`/leads/${lead.body.data.id}`);
    expect(res.status).toBe(404); // tenant-aware : invisible, pas 403
  });
});

describe('génération (transaction + crédits)', () => {
  it('génère un site, débite 1 crédit, enrôle la séquence', async () => {
    const { agent } = await newUser('gen');
    const lead = await agent.post('/leads').send({ name: 'Resto', activity: 'restaurant', city: 'Nice', email: email('lead') });
    const gen  = await agent.post('/generate').send({ leadId: lead.body.data.id, templateId: 'moderne' });
    expect(gen.status).toBe(201);
    expect(gen.body.data.slug).toBeTruthy();

    const credits = await agent.get('/sites/credits');
    expect(credits.body.data.credits).toBe(9); // 10 - 1

    const seq = getDb().prepare('SELECT status, channel FROM email_sequence WHERE site_id = ?').get(gen.body.data.id);
    expect(seq.channel).toBe('email');
    expect(seq.status).toBe('pending');
  });
});

describe('formulaire de contact', () => {
  it('arrête la séquence et passe le lead en rappeler', async () => {
    const { agent } = await newUser('contact');
    const lead = await agent.post('/leads').send({ name: 'Garage', activity: 'garagiste', city: 'Lille', email: email('g') });
    const gen  = await agent.post('/generate').send({ leadId: lead.body.data.id });
    const slug = gen.body.data.slug;

    const res = await request(app).post(`/contact/${slug}`).send({ name: 'Client', phone: '0612345678' });
    expect(res.status).toBe(201);

    const seq = getDb().prepare('SELECT status FROM email_sequence WHERE site_id = ?').get(gen.body.data.id);
    expect(seq.status).toBe('done');
    const leadRow = getDb().prepare('SELECT pipeline FROM leads WHERE id = ?').get(lead.body.data.id);
    expect(leadRow.pipeline).toBe('rappeler');
  });
});

describe('observabilité & accès', () => {
  it('/health public est minimal (pas d\'infra exposée)', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBeTruthy();
    expect(res.body.queues).toBeUndefined();
    expect(res.body.memory).toBeUndefined();
  });

  it('/health/details et /queue refusent un non-admin (403)', async () => {
    const { agent } = await newUser('nonadmin');
    expect((await agent.get('/health/details')).status).toBe(403);
    expect((await agent.get('/queue/stats')).status).toBe(403);
  });

  it('un admin accède à /health/details', async () => {
    const { agent, user } = await newUser('admin');
    getDb().prepare('UPDATE users SET is_admin = 1 WHERE id = ?').run(user.id);
    const res = await agent.get('/health/details');
    expect(res.status).toBe(200);
    expect(res.body.queues).toBeTruthy();
  });
});

describe('couche données centralisée (étape 2 PG)', () => {
  it('GET /dashboard renvoie les métriques agrégées', async () => {
    const { agent } = await newUser('dash');
    const res = await agent.get('/dashboard');
    expect(res.status).toBe(200);
    expect(res.body.data.summary).toBeDefined();
    expect(res.body.data.email_stats).toBeDefined();
    expect(Array.isArray(res.body.data.hot_leads)).toBe(true);
  });

  it('GET /analytics renvoie un résumé', async () => {
    const { agent } = await newUser('ana');
    const res = await agent.get('/analytics');
    expect(res.status).toBe(200);
    expect(res.body.data.summary.total_leads).toBe(0);
  });

  it('GET /leads/:id/timeline renvoie une timeline', async () => {
    const { agent } = await newUser('tl');
    const lead = await agent.post('/leads').send({ name: 'TL', activity: 'plombier', city: 'Lyon' });
    const res = await agent.get(`/leads/${lead.body.data.id}/timeline`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data.timeline)).toBe(true);
  });

  it('GET /track/stats renvoie les taux (humain vs brut)', async () => {
    const { agent } = await newUser('stats');
    const res = await agent.get('/track/stats');
    expect(res.status).toBe(200);
    expect(res.body.data.sent).toBe(0);
    expect(res.body.data).toHaveProperty('human_open_rate');
  });
});

describe('conformité légale', () => {
  it('les pages légales sont publiques', async () => {
    for (const path of ['/legal', '/legal/mentions', '/legal/confidentialite', '/legal/cgv']) {
      const res = await request(app).get(path);
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toMatch(/html/);
    }
  });

  it('export RGPD : toutes les données du compte, scoppées au user', async () => {
    const a = await newUser('exp');
    await a.agent.post('/leads').send({ name: 'Lead Exp', activity: 'plombier', city: 'Lyon' });
    const b = await newUser('exp-other');
    await b.agent.post('/leads').send({ name: 'Lead Autre', activity: 'maçon', city: 'Paris' });

    const res = await a.agent.get('/users/me/export');
    expect(res.status).toBe(200);
    expect(res.headers['content-disposition']).toMatch(/attachment/);
    const dump = JSON.parse(res.text);
    expect(dump.account.email).toBe(a.email);
    expect(dump.account.password_hash).toBeUndefined(); // jamais exporté
    expect(dump.leads.length).toBe(1);
    expect(dump.leads[0].name).toBe('Lead Exp');         // pas le lead de l'autre compte
    expect(Array.isArray(dump.invoices)).toBe(true);
  });

  it('l\'export exige une authentification', async () => {
    const res = await request(app).get('/users/me/export');
    expect(res.status).toBe(401);
  });
});

describe('réponses entrantes', () => {
  it('le webhook stoppe la séquence du lead qui répond', async () => {
    const { agent } = await newUser('inbound');
    const leadEmail = email('replier');
    const lead = await agent.post('/leads').send({ name: 'Boulangerie', activity: 'boulanger', city: 'Tours', email: leadEmail });
    const gen  = await agent.post('/generate').send({ leadId: lead.body.data.id });

    const bad = await request(app).post('/inbound/wrong-secret').send({ from: leadEmail });
    expect(bad.status).toBe(403);

    const res = await request(app).post('/inbound/test-inbound-secret')
      .send({ from: `Client <${leadEmail}>`, subject: 'Re', text: 'Intéressé' });
    expect(res.status).toBe(200);
    expect(res.body.data.matched).toBe(1);

    const seq = getDb().prepare('SELECT status FROM email_sequence WHERE site_id = ?').get(gen.body.data.id);
    expect(seq.status).toBe('done');
  });
});
