/**
 * retention.test.js — Agrégation puis purge des événements.
 *
 * Ce que ces tests protègent : aucune suppression ne doit jamais avoir lieu
 * sans que le compte correspondant ait été reporté dans events_daily. Une purge
 * qui perd les chiffres historiques est pire que pas de purge du tout.
 */
import { beforeAll, describe, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { runMigrations, getDb } from '../src/db/database.js';
import { purgeOldEvents } from '../src/services/retentionService.js';

let uid;
beforeAll(() => {
  runMigrations();
  // events.user_id référence users(id) : il faut un compte réel.
  uid = randomUUID();
  getDb().prepare('INSERT INTO users (id, email, credits) VALUES (?, ?, 0)')
    .run(uid, `retention-${uid}@test.fr`);
});

/** Insère un event daté de `daysAgo` jours. */
function seedEvent({ type = 'demo_view', userId = null, daysAgo = 0 }) {
  getDb().prepare(
    "INSERT INTO events (id, type, user_id, created_at) VALUES (?, ?, ?, datetime('now', ?))"
  ).run(randomUUID(), type, userId, `-${daysAgo} days`);
}

const countEvents = () => getDb().prepare('SELECT COUNT(*) n FROM events').get().n;
const daily = (type, userId = '') =>
  getDb().prepare('SELECT count FROM events_daily WHERE type = ? AND user_id = ?').get(type, userId)?.count ?? 0;

describe('purgeOldEvents', () => {
  it('agrège les vieux événements puis les supprime, et laisse les récents', () => {
    const db = getDb();
    db.prepare('DELETE FROM events').run();
    db.prepare('DELETE FROM events_daily').run();

    // 3 vues le même vieux jour, 1 clic vieux, 2 vues récentes
    seedEvent({ type: 'demo_view', userId: uid, daysAgo: 400 });
    seedEvent({ type: 'demo_view', userId: uid, daysAgo: 400 });
    seedEvent({ type: 'demo_view', userId: uid, daysAgo: 400 });
    seedEvent({ type: 'click_cta',  userId: uid, daysAgo: 400 });
    seedEvent({ type: 'demo_view', userId: uid, daysAgo: 5 });
    seedEvent({ type: 'demo_view', userId: uid, daysAgo: 5 });

    const res = purgeOldEvents(365);

    expect(res.eventsDeleted).toBe(4);
    expect(countEvents()).toBe(2);               // les récents sont intacts
    expect(daily('demo_view', uid)).toBe(3);     // le détail est devenu un compte
    expect(daily('click_cta', uid)).toBe(1);
  });

  it('cumule sans doublon quand la purge repasse (user_id NULL inclus)', () => {
    const db = getDb();
    db.prepare('DELETE FROM events').run();
    db.prepare('DELETE FROM events_daily').run();

    seedEvent({ type: 'email_sent', userId: null, daysAgo: 400 });
    purgeOldEvents(365);
    expect(daily('email_sent', '')).toBe(1);

    // Deuxième vague, même jour, même type : le compte s'additionne au lieu de
    // créer une seconde ligne (NULL n'est pas comparable à NULL en SQLite).
    seedEvent({ type: 'email_sent', userId: null, daysAgo: 400 });
    purgeOldEvents(365);
    expect(daily('email_sent', '')).toBe(2);

    const lignes = getDb()
      .prepare("SELECT COUNT(*) n FROM events_daily WHERE type = 'email_sent'").get().n;
    expect(lignes).toBe(1);
  });

  it('ne supprime rien quand la rétention est désactivée (0)', () => {
    getDb().prepare('DELETE FROM events').run();
    seedEvent({ type: 'demo_view', daysAgo: 9999 });

    const res = purgeOldEvents(0);

    expect(res.skipped).toBe(true);
    expect(countEvents()).toBe(1);
  });

  it('ne jette pas sur une base sans rien à purger', () => {
    getDb().prepare('DELETE FROM events').run();
    expect(() => purgeOldEvents(365)).not.toThrow();
    expect(purgeOldEvents(365).eventsDeleted).toBe(0);
  });
});
