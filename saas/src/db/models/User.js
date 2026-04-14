import { getDb } from '../database.js';
import { randomUUID } from 'crypto';
import { config } from '../../config/config.js';

export const User = {
  create({ email, name }) {
    const db = getDb();
    const id = randomUUID();
    db.prepare(`
      INSERT INTO users (id, email, name, credits)
      VALUES (?, ?, ?, ?)
    `).run(id, email, name || null, config.credits.defaultOnSignup);
    return this.findById(id);
  },

  findById(id) {
    return getDb().prepare('SELECT * FROM users WHERE id = ?').get(id);
  },

  findByEmail(email) {
    return getDb().prepare('SELECT * FROM users WHERE email = ?').get(email);
  },

  /**
   * Déduit des crédits de manière atomique.
   * Retourne false si crédits insuffisants.
   */
  deductCredits(userId, amount) {
    const db = getDb();
    const result = db.prepare(`
      UPDATE users
      SET credits = credits - ?
      WHERE id = ? AND credits >= ?
    `).run(amount, userId, amount);
    return result.changes > 0;
  },

  addCredits(userId, amount) {
    getDb().prepare(`
      UPDATE users SET credits = credits + ? WHERE id = ?
    `).run(amount, userId);
  },
};
