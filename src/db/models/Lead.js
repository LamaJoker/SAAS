import { getDb }     from '../database.js';
import { randomUUID } from 'crypto';

export const Lead = {
  create({ userId, name, activity, city, email, phone, website = null, emailSource = null }) {
    const db = getDb();
    const id = randomUUID();
    db.prepare(`
      INSERT INTO leads (id, user_id, name, activity, city, email, phone, email_source)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, userId, name, activity, city, email || null, phone || null, emailSource);
    return this.findById(id);
  },

  findById(id) {
    return getDb().prepare('SELECT * FROM leads WHERE id = ?').get(id);
  },

  // ── Méthodes tenant-aware : l'appartenance est garantie au niveau data ─────
  // Les routes n'ont plus à refaire `lead.user_id !== req.userId`.
  findByIdForUser(id, userId) {
    return getDb().prepare('SELECT * FROM leads WHERE id = ? AND user_id = ?').get(id, userId);
  },

  findAllByUser(userId, { limit = null, offset = 0 } = {}) {
    if (limit === null) {
      return getDb().prepare(
        'SELECT * FROM leads WHERE user_id = ? ORDER BY created_at DESC'
      ).all(userId);
    }
    return getDb().prepare(
      'SELECT * FROM leads WHERE user_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?'
    ).all(userId, limit, offset);
  },

  countByUser(userId) {
    return getDb().prepare('SELECT COUNT(*) AS n FROM leads WHERE user_id = ?').get(userId).n;
  },

  updateStatus(id, status) {
    getDb().prepare('UPDATE leads SET status = ? WHERE id = ?').run(status, id);
  },

  updateCrm(id, { pipeline, note }) {
    const db = getDb();
    if (pipeline !== undefined) db.prepare('UPDATE leads SET pipeline = ? WHERE id = ?').run(pipeline, id);
    if (note     !== undefined) db.prepare('UPDATE leads SET note = ? WHERE id = ?').run(note, id);
    return this.findById(id);
  },

  updateCrmForUser(id, userId, { pipeline, note }) {
    const db = getDb();
    if (pipeline !== undefined) {
      const r = db.prepare('UPDATE leads SET pipeline = ? WHERE id = ? AND user_id = ?').run(pipeline, id, userId);
      if (r.changes === 0) return null;
    }
    if (note !== undefined) {
      const r = db.prepare('UPDATE leads SET note = ? WHERE id = ? AND user_id = ?').run(note, id, userId);
      if (r.changes === 0) return null;
    }
    return this.findByIdForUser(id, userId);
  },

  deleteById(id) {
    getDb().prepare('DELETE FROM leads WHERE id = ?').run(id);
  },

  deleteByIdForUser(id, userId) {
    return getDb().prepare('DELETE FROM leads WHERE id = ? AND user_id = ?').run(id, userId).changes > 0;
  },
};
