/**
 * Express 4 ne capture pas les promesses rejetées : un handler async sans
 * try/catch laisse la requête pendante jusqu'au timeout du client, sans
 * réponse ni trace côté appelant. Ces tests simulent une panne de base sur
 * les routes concernées et exigent une réponse rapide et exploitable.
 */
import { beforeAll, beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import request from 'supertest';

vi.mock('../src/db/queries.js', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, clickRegistered: vi.fn(actual.clickRegistered) };
});

const { createApp }       = await import('../src/api/index.js');
const { runMigrations }   = await import('../src/db/database.js');
const { repo }            = await import('../src/db/repo.js');
const { clickRegistered } = await import('../src/db/queries.js');
const { config }          = await import('../src/config/config.js');
const { logger }          = await import('../src/utils/logger.js');

let app;
beforeAll(() => { runMigrations(); app = createApp(); });
// L'erreur simulée est journalisée par errorHandler : attendu, on la tait.
beforeEach(() => { vi.spyOn(logger, 'error').mockImplementation(() => {}); });
afterEach(() => { vi.restoreAllMocks(); });

const FAST = 2000; // une requête pendante dépasserait ce délai

describe('routes async — panne de base', () => {
  it('GET /users/me répond 500 avec un requestId au lieu de pendre', async () => {
    const agent = request.agent(app);
    await agent.post('/users/register').send({ email: `err-${Date.now()}@test.fr`, password: 'Password1234' });

    const original = repo.users.findById;
    vi.spyOn(repo.users, 'findById')
      .mockImplementationOnce(original)                     // authenticate
      .mockRejectedValueOnce(new Error('SQLITE_BUSY'));     // handler

    const res = await agent.get('/users/me').timeout(FAST);
    expect(res.status).toBe(500);
    expect(res.body.requestId).toBeTruthy();
  }, FAST + 1000);

  it('une panne de base pendant l\'authentification renvoie 500, pas 401 (pas de déconnexion)', async () => {
    const agent = request.agent(app);
    await agent.post('/users/register').send({ email: `auth-${Date.now()}@test.fr`, password: 'Password1234' });

    vi.spyOn(repo.users, 'findById').mockRejectedValueOnce(new Error('SQLITE_BUSY'));
    const res = await agent.get('/sites/credits').timeout(FAST);
    expect(res.status).toBe(500);

    // Le JWT invalide reste, lui, un 401
    const bad = await request(app).get('/sites/credits').set('Authorization', 'Bearer abc.def.ghi');
    expect(bad.status).toBe(401);
  }, FAST + 1000);

  it('un cookie mal encodé ne provoque pas d\'erreur serveur', async () => {
    const res = await request(app).get('/users/me').set('Cookie', 'tracker=%E0%A4%A; authToken=abc');
    expect(res.status).toBe(401); // token invalide, pas 500
  });

  it('GET /track/click redirige le prospect même si la base est indisponible', async () => {
    clickRegistered.mockRejectedValueOnce(new Error('SQLITE_BUSY'));
    const res = await request(app).get('/track/click/abc123').redirects(0).timeout(FAST);
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe(config.server.baseUrl);
  }, FAST + 1000);
});
