/**
 * Désinscription : bouton natif des clients mail (RFC 8058, POST) et lien du
 * footer (GET → confirmation → POST). Une simple visite du lien — passerelle
 * de sécurité de messagerie — ne désinscrit personne.
 */
import { beforeAll, describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/api/index.js';
import { runMigrations, getDb } from '../src/db/database.js';
import { buildUnsubToken, buildUnsubUrl } from '../src/utils/unsubToken.js';
import { unsubscribeHeaders, renderEmail } from '../src/email/render.js';

let app;
beforeAll(() => { runMigrations(); app = createApp(); });

const blacklisted = (email) =>
  !!getDb().prepare('SELECT 1 FROM email_blacklist WHERE email = ?').get(email.toLowerCase());
const addr = () => `prospect-${Date.now()}-${Math.random().toString(16).slice(2, 6)}@exemple.fr`;

describe('désinscription', () => {
  it('chaque email porte List-Unsubscribe et List-Unsubscribe-Post (RFC 8058)', () => {
    const email = addr();
    const h = unsubscribeHeaders(email);
    // Forme RFC 2369 : URL entre chevrons, se terminant par le token signé
    expect(h['List-Unsubscribe']).toBe(`<${buildUnsubUrl(email)}>`);
    expect(buildUnsubUrl(email).endsWith(`/unsubscribe/${buildUnsubToken(email)}`)).toBe(true);
    expect(h['List-Unsubscribe-Post']).toBe('List-Unsubscribe=One-Click');
  });

  it('l\'en-tête et le footer pointent vers la même URL', () => {
    const email = addr();
    const { html } = renderEmail('direct', { name: 'X', city: 'Y', sender: 'Z', trackedUrl: '#', pixelUrl: '#', toEmail: email });
    const url = unsubscribeHeaders(email)['List-Unsubscribe'].slice(1, -1);
    expect(html).toContain(url);
  });

  it('bouton natif du client mail : POST One-Click → désinscrit', async () => {
    const email = addr();
    const res = await request(app).post(`/unsubscribe/${buildUnsubToken(email)}`)
      .type('form').send('List-Unsubscribe=One-Click');
    expect(res.status).toBe(200);
    expect(blacklisted(email)).toBe(true);
  });

  it('visite du lien (scanner) : confirmation affichée, personne n\'est désinscrit', async () => {
    const email = addr();
    const res = await request(app).get(`/unsubscribe/${buildUnsubToken(email)}`);
    expect(res.status).toBe(200);
    expect(res.text).toMatch(/<form method="post"/);
    expect(blacklisted(email)).toBe(false);
  });

  it('confirmation idempotente, token altéré refusé', async () => {
    const email = addr();
    const token = buildUnsubToken(email);
    expect((await request(app).post(`/unsubscribe/${token}`)).status).toBe(200);
    expect((await request(app).post(`/unsubscribe/${token}`)).status).toBe(200);
    expect((await request(app).post(`/unsubscribe/${token.split('.')[0]}.aaaaaaaaaaaaaaaa`)).status).toBe(400);
  });
});
