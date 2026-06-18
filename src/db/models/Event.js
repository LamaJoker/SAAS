import { getDb } from '../database.js';
import { randomUUID } from 'crypto';

export const EVENT_TYPES = {
  EMAIL_SENT:   'email_sent',
  DEMO_VIEW:    'demo_view',
  CLICK_CTA:    'click_cta',
  CONTACT_FORM: 'contact_form',
};

export const Event = {
  track({ type, leadId = null, siteId = null, userId = null, meta = null }) {
    const db = getDb();
    const id = randomUUID();
    db.prepare(`
      INSERT INTO events (id, type, lead_id, site_id, user_id, meta)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(id, type, leadId, siteId, userId, meta ? JSON.stringify(meta) : null);
    return id;
  },
  countByType(type) {
    return getDb()
      .prepare('SELECT COUNT(*) as n FROM events WHERE type = ?')
      .get(type).n;
  },
  countUniqueSites(type) {
    return getDb()
      .prepare('SELECT COUNT(DISTINCT site_id) as n FROM events WHERE type = ? AND site_id IS NOT NULL')
      .get(type).n;
  },
  totalViews() {
    return getDb()
      .prepare("SELECT COUNT(*) as n FROM events WHERE type = 'demo_view'")
      .get().n;
  },
  recentByType(type, limit = 20) {
    return getDb()
      .prepare('SELECT * FROM events WHERE type = ? ORDER BY created_at DESC LIMIT ?')
      .all(type, limit);
  },
};