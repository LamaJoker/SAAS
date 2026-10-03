/**
 * Les relances sont de vraies réponses au premier email : objet « Re: <objet
 * du premier email> », In-Reply-To / References vers les envois précédents,
 * même compte d'envoi. Jamais de « Re: » inventé hors fil.
 */
import { beforeAll, afterEach, describe, it, expect, vi } from 'vitest';
import request from 'supertest';

// Transporteurs SMTP factices pour tester la sélection de compte du pool
const sent = [];
vi.mock('nodemailer', () => ({
  default: {
    createTransport: ({ auth }) => ({
      sendMail: async (opts) => { sent.push({ via: auth.user, opts }); return { messageId: `<${sent.length}@${auth.user}>` }; },
      verify: async () => true,
    }),
  },
}));

const { buildThread, normalizeMessageId } = await import('../src/email/thread.js');
const { renderEmail }        = await import('../src/email/render.js');
const { VARIANT_IDS, FOLLOWUP_IDS } = await import('../src/email/index.js');
const { SmtpPool, smtpPool } = await import('../src/services/smtpPool.js');
const { createApp }          = await import('../src/api/index.js');
const { runMigrations, getDb } = await import('../src/db/database.js');
const { processSequence }    = await import('../src/services/sequenceService.js');

afterEach(() => { vi.restoreAllMocks(); });

describe('buildThread', () => {
  const first = { message_id: '<j0@mail.autodemo.fr>', subject: 'Votre site à Lyon — démo prête', sent_via: 'a@autodemo.fr' };

  it('premier envoi : objet propre de la variante, aucun en-tête de fil', () => {
    expect(buildThread([], 'Garage Martin — 30 secondes'))
      .toEqual({ subject: 'Garage Martin — 30 secondes', headers: {}, preferSender: null });
  });

  it('relance : « Re: » + objet exact du premier email, chaîne des Message-ID, même compte', () => {
    const second = { message_id: '<j3@mail.autodemo.fr>', subject: 'Re: Votre site à Lyon — démo prête', sent_via: 'a@autodemo.fr' };
    expect(buildThread([first, second], 'Dernier message — Garage Martin')).toEqual({
      subject: 'Re: Votre site à Lyon — démo prête',
      headers: { 'In-Reply-To': '<j3@mail.autodemo.fr>', 'References': '<j0@mail.autodemo.fr> <j3@mail.autodemo.fr>' },
      preferSender: 'a@autodemo.fr',
    });
  });

  it('jamais de « Re: Re: »', () => {
    const t = buildThread([{ ...first, subject: 'Re: RE: Votre site' }], 'x');
    expect(t.subject).toBe('Re: Votre site');
  });

  it('envoi antérieur sans objet conservé : objet propre, pas de « Re: » inventé', () => {
    const t = buildThread([{ ...first, subject: null }], 'Garage Martin — votre démo est toujours en ligne');
    expect(t.subject).toBe('Garage Martin — votre démo est toujours en ligne');
    expect(t.headers).toEqual({});
  });

  it('un Message-ID malformé ou piégé n\'entre jamais dans un en-tête', () => {
    expect(normalizeMessageId('j0@mail.fr')).toBe('<j0@mail.fr>');
    expect(normalizeMessageId('<a@b>\r\nBcc: victime@x.fr')).toBeNull();
    expect(normalizeMessageId('')).toBeNull();
    expect(buildThread([{ ...first, message_id: '' }], 'Objet propre').subject).toBe('Objet propre');
  });
});

describe('templates — aucun faux « Re: »', () => {
  it.each([...VARIANT_IDS, ...FOLLOWUP_IDS])('« %s »', (id) => {
    const { subject } = renderEmail(id, { name: 'Garage Martin', city: 'Lyon', sender: 'S', trackedUrl: '#', pixelUrl: '#', toEmail: 'a@b.fr' });
    expect(subject).not.toMatch(/^\s*(re|tr|fwd?)\s*:/i);
  });
});

describe('pool SMTP — compte du fil', () => {
  const cfg = (user, hourlyLimit = 80) => ({ host: 'smtp.test', user, pass: 'x', hourlyLimit });

  it('réutilise le compte demandé, hors rotation, sans transmettre les options internes', async () => {
    sent.length = 0;
    const pool = new SmtpPool([cfg('a@test'), cfg('b@test'), cfg('c@test')]);
    await pool.send({ to: 'p@x.fr', subject: 's', text: 't', preferUser: 'c@test', fromName: 'AutoDemo' });
    await pool.send({ to: 'p@x.fr', subject: 's', text: 't', preferUser: 'c@test', fromName: 'AutoDemo' });
    expect(sent.map(s => s.via)).toEqual(['c@test', 'c@test']);
    expect(sent[0].opts).not.toHaveProperty('preferUser');
    expect(sent[0].opts).not.toHaveProperty('fromName');
    expect(sent[0].opts.from).toBe('"AutoDemo" <c@test>');
  });

  it('se rabat sur la rotation quand le compte demandé a atteint son quota', async () => {
    sent.length = 0;
    const pool = new SmtpPool([cfg('a@test'), cfg('b@test', 1)]);
    await pool.send({ to: 'p@x.fr', subject: 's', text: 't', preferUser: 'b@test' });
    const r = await pool.send({ to: 'p@x.fr', subject: 's', text: 't', preferUser: 'b@test' });
    expect(sent.map(s => s.via)).toEqual(['b@test', 'a@test']);
    expect(r.sentVia).toBe('a@test');
  });
});

describe('séquence — J0 puis J+3 dans le même fil', () => {
  let app;
  beforeAll(() => { runMigrations(); app = createApp(); });

  it('la relance répond au premier email, depuis le même compte', async () => {
    const agent = request.agent(app);
    await agent.post('/users/register').send({ email: `thread-${Date.now()}@test.fr`, password: 'Password1234' });
    const lead = await agent.post('/leads').send({ name: 'Garage Martin', activity: 'garagiste', city: 'Lyon', email: 'contact@garage-martin.fr' });
    const site = (await agent.post('/generate').send({ leadId: lead.body.data.id })).body.data;

    // SMTP actif après l'inscription (sinon le compte ne serait pas vérifié d'office)
    vi.spyOn(smtpPool, 'isConfigured', 'get').mockReturnValue(true);
    const send = vi.spyOn(smtpPool, 'send')
      .mockResolvedValueOnce({ messageId: '<j0@mail.autodemo.fr>', sentVia: 'compte-b@autodemo.fr' })
      .mockResolvedValueOnce({ messageId: '<j3@mail.autodemo.fr>', sentVia: 'compte-b@autodemo.fr' });

    await processSequence(); // J0
    getDb().prepare("UPDATE email_sequence SET next_send_at = datetime('now', '-1 minute') WHERE site_id = ?").run(site.id);
    await processSequence(); // J+3

    const [j0, j3] = send.mock.calls.map(c => c[0]);
    expect(j0.subject).not.toMatch(/^Re:/);
    expect(j0.headers).not.toHaveProperty('In-Reply-To');

    expect(j3.subject).toBe(`Re: ${j0.subject}`);
    expect(j3.headers['In-Reply-To']).toBe('<j0@mail.autodemo.fr>');
    expect(j3.headers['References']).toBe('<j0@mail.autodemo.fr>');
    expect(j3.preferUser).toBe('compte-b@autodemo.fr');

    const rows = getDb().prepare('SELECT subject, sent_via FROM email_sends WHERE site_id = ? ORDER BY created_at, rowid').all(site.id);
    expect(rows).toEqual([
      { subject: j0.subject, sent_via: 'compte-b@autodemo.fr' },
      { subject: j3.subject, sent_via: 'compte-b@autodemo.fr' },
    ]);
  }, 20_000);
});
