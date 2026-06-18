import { getDb } from '../database.js';
import { randomUUID } from 'crypto';

export const Site = {
  create({ leadId, userId, slug, outputPath, url, template = 'moderne' }) {
    const db = getDb();
    const id = randomUUID();
    db.prepare(`
      INSERT INTO sites (id, lead_id, user_id, slug, output_path, url, template)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(id, leadId, userId, slug, outputPath, url, template);
    return this.findById(id);
  },
  findById(id) {
    return getDb().prepare('SELECT * FROM sites WHERE id = ?').get(id);
  },
  findByIdForUser(id, userId) {
    return getDb().prepare('SELECT * FROM sites WHERE id = ? AND user_id = ?').get(id, userId);
  },
  findBySlug(slug) {
    return getDb().prepare('SELECT * FROM sites WHERE slug = ?').get(slug);
  },
  findAllByUser(userId) {
    return getDb().prepare(`
      SELECT s.*, l.name AS lead_name, l.city
      FROM sites s
      JOIN leads l ON l.id = s.lead_id
      WHERE s.user_id = ? ORDER BY s.created_at DESC
    `).all(userId);
  },
  incrementViews(id) {
    getDb().prepare(`
      UPDATE sites
      SET views = views + 1, last_viewed = datetime('now')
      WHERE id = ?
    `).run(id);
  },
};