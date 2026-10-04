/**
 * La séquence froide s'arrête dès qu'un humain a repris la relation dans le CRM.
 * Relancer automatiquement un client converti ou un prospect perdu coûte la
 * vente, et pour un refus c'est une sollicitation après opposition.
 */
import { beforeAll, afterEach, describe, it, expect, vi } from 'vitest';
import { randomUUID } from 'crypto';
import { runMigrations, getDb } from '../src/db/database.js';
import { processSequence, isHandledByHuman } from '../src/services/sequenceService.js';
import { smtpPool } from '../src/services/smtpPool.js';

beforeAll(() => { runMigrations(); });
afterEach(() => { vi.restoreAllMocks(); });

function seedEnrolledLead(pipeline) {
  const db = getDb();
  const userId = randomUUID(), leadId = randomUUID(), siteId = randomUUID();
  db.prepare('INSERT INTO users (id, email, credits) VALUES (?, ?, 0)').run(userId, `${userId}@test.fr`);
  db.prepare(`INSERT INTO leads (id, user_id, name, activity, city, email, status, pipeline)
              VALUES (?, ?, 'Garage Test', 'garagiste', 'Lyon', ?, 'done', ?)`)
    .run(leadId, userId, `contact-${leadId}@garage-test.fr`, pipeline);
  db.prepare(`INSERT INTO sites (id, lead_id, user_id, slug, output_path, url)
              VALUES (?, ?, ?, ?, '/tmp/x', 'https://demo.test/x')`)
    .run(siteId, leadId, userId, `garage-test-${siteId.slice(0, 8)}`);
  db.prepare(`INSERT INTO email_sequence (id, site_id, lead_id, step, status, next_send_at, channel)
              VALUES (?, ?, ?, 1, 'pending', datetime('now', '-1 minute'), 'email')`)
    .run(randomUUID(), siteId, leadId);
  return leadId;
}

const seqStatus = (leadId) =>
  getDb().prepare('SELECT status FROM email_sequence WHERE lead_id = ?').get(leadId).status;

describe('séquence — reprise humaine', () => {
  it('isHandledByHuman : seul « nouveau » laisse la séquence tourner', () => {
    expect(isHandledByHuman({ pipeline: 'nouveau' })).toBe(false);
    for (const p of ['contacte', 'interesse', 'rappeler', 'converti', 'perdu']) {
      expect(isHandledByHuman({ pipeline: p })).toBe(true);
    }
  });

  it.each(['converti', 'perdu', 'rappeler'])('lead « %s » : aucun envoi, séquence close', async (pipeline) => {
    vi.spyOn(smtpPool, 'isConfigured', 'get').mockReturnValue(true);
    const send = vi.spyOn(smtpPool, 'send').mockResolvedValue({ messageId: 'test' });
    const leadId = seedEnrolledLead(pipeline);

    await processSequence();

    expect(send).not.toHaveBeenCalledWith(expect.objectContaining({ to: `contact-${leadId}@garage-test.fr` }));
    expect(seqStatus(leadId)).toBe('done');
  });
});
