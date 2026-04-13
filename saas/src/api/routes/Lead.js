import { getDb } from '../database.js';
import { randomUUID } from 'crypto';

export const Lead = {
  create({ userId, name, activity, city, email, phone }) {
    const db = getDb();
    const id = randomUUID();
    db.prepare(`
      INSERT INTO leads (id, user_id, name, activity, city, email, phone)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(id, userId, name, activity, city, email || null, phone || null);
    return this.findById(id);
  },

  findById(id) {
    return getDb().prepare('SELECT * FROM leads WHERE id = ?').get(id);
  },

  findAllByUser(userId) {
    return getDb().prepare(`
      SELECT * FROM leads WHERE user_id = ? ORDER BY created_at DESC
    `).all(userId);
  },

  updateStatus(id, status) {
    getDb().prepare('UPDATE leads SET status = ? WHERE id = ?').run(status, id);
  },
};
