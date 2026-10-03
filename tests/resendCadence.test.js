/**
 * Relance manuelle (/resend). La variante forcée choisit le texte, jamais
 * l'autorisation d'envoyer : plafond de 3 emails, espacement minimal et
 * séquence automatique active s'appliquent toujours. Un refus est expliqué
 * à l'utilisateur au lieu d'être présenté comme un envoi réussi.
 */
import { beforeAll, afterEach, describe, it, expect, vi } from 'vitest';
import request from 'supertest';
import { randomUUID } from 'crypto';
import { createApp } from '../src/api/index.js';
import { runMigrations, getDb } from '../src/db/database.js';
import { smtpPool } from '../src/services/smtpPool.js';
import { config } from '../src/config/config.js';

let app;
beforeAll(() => { runMigrations(); app = createApp(); });
afterEach(() => { vi.restoreAllMocks(); });

async function siteWithEmailLead() {
  const agent = request.agent(app);
  await agent.post('/users/register').send({ email: `rs-${randomUUID()}@test.fr`, password: 'Password1234' });
  const lead = await agent.post('/leads').send({
    name: 'Serrurerie Faure', activity: 'serrurier', city: 'Belfort', email: `contact-${randomUUID()}@serrurerie.fr`,
  });
  const site = await agent.post('/generate').send({ leadId: lead.body.data.id });
  return { agent, siteId: site.body.data.id, leadId: lead.body.data.id };
}

// Après l'inscription : avec SMTP actif, le compte ne serait pas vérifié d'office.
function smtpUp() {
  vi.spyOn(smtpPool, 'isConfigured', 'get').mockReturnValue(true);
  return vi.spyOn(smtpPool, 'send').mockResolvedValue({ messageId: '<test@local>' });
}
const endSequence = (siteId) =>
  getDb().prepare("UPDATE email_sequence SET status = 'done' WHERE site_id = ?").run(siteId);
const fakeSends = (siteId, leadId, n, daysAgo) => {
  for (let i = 0; i < n; i++) {
    getDb().prepare(`INSERT INTO email_sends (id, site_id, lead_id, variant_id, message_id, created_at)
                     VALUES (?, ?, ?, 'direct', 'x', datetime('now', ?))`)
      .run(randomUUID(), siteId, leadId, `-${daysAgo} days`);
  }
};

describe('relance manuelle — cadence', () => {
  it('refusée tant qu\'une relance automatique est programmée', async () => {
    const { agent, siteId } = await siteWithEmailLead(); // séquence J0 enrôlée
    const send = smtpUp();
    const res = await agent.post(`/resend/${siteId}`).send({});
    expect(res.body.data).toMatchObject({ sent: false, reason: 'sequence_active' });
    expect(res.body.data.message).toMatch(/déjà programmée/);
    expect(send).not.toHaveBeenCalled();
  });

  it('envoie avec la même identité dans « De : » et dans la signature', async () => {
    const { agent, siteId } = await siteWithEmailLead();
    const send = smtpUp();
    endSequence(siteId);
    const res = await agent.post(`/resend/${siteId}`).send({});
    expect(res.body.data.sent).toBe(true);
    const mail = send.mock.calls[0][0];
    expect(mail.fromName).toBe(config.email.senderName);
    expect(mail.text).toContain(config.email.senderName);
    expect(mail.headers['List-Unsubscribe-Post']).toBe('List-Unsubscribe=One-Click');
  });

  it('variante forcée : l\'espacement minimal s\'applique quand même', async () => {
    const { agent, siteId, leadId } = await siteWithEmailLead();
    const send = smtpUp();
    endSequence(siteId);
    fakeSends(siteId, leadId, 1, 0); // un email aujourd'hui
    const res = await agent.post(`/resend/${siteId}`).send({ variantId: 'direct' });
    expect(res.body.data).toMatchObject({ sent: false, reason: 'too_soon' });
    expect(send).not.toHaveBeenCalled();
  });

  it('variante forcée : le plafond de 3 emails s\'applique quand même', async () => {
    const { agent, siteId, leadId } = await siteWithEmailLead();
    const send = smtpUp();
    endSequence(siteId);
    fakeSends(siteId, leadId, 3, 10);
    const res = await agent.post(`/resend/${siteId}`).send({ variantId: 'direct' });
    expect(res.body.data).toMatchObject({ sent: false, reason: 'sequence_complete' });
    expect(send).not.toHaveBeenCalled();
  });
});
