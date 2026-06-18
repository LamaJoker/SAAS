import { getDb }      from '../database.js';
import { randomUUID } from 'crypto';
import { config }     from '../../config/config.js';

export const User = {
  create({ email, name, passwordHash, emailVerified = false, verifyToken = null }) {
    const db = getDb();
    const id = randomUUID();
    db.prepare(`
      INSERT INTO users (id, email, name, password_hash, credits, email_verified, verify_token)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(id, email, name || null, passwordHash || null,
      config.credits.defaultOnSignup, emailVerified ? 1 : 0, verifyToken);
    return this.findById(id);
  },

  findById(id) {
    return getDb().prepare('SELECT * FROM users WHERE id = ?').get(id);
  },

  findByEmail(email) {
    return getDb().prepare('SELECT * FROM users WHERE email = ?').get(email);
  },

  findByVerifyToken(tokenHash) {
    return getDb().prepare('SELECT * FROM users WHERE verify_token = ?').get(tokenHash);
  },

  findByResetToken(tokenHash) {
    return getDb().prepare(`
      SELECT * FROM users
      WHERE reset_token = ? AND reset_expires > datetime('now')
    `).get(tokenHash);
  },

  markVerified(userId) {
    getDb().prepare(
      'UPDATE users SET email_verified = 1, verify_token = NULL WHERE id = ?'
    ).run(userId);
  },

  setVerifyToken(userId, tokenHash) {
    getDb().prepare('UPDATE users SET verify_token = ? WHERE id = ?').run(tokenHash, userId);
  },

  setResetToken(userId, tokenHash, expiresIso) {
    getDb().prepare(
      'UPDATE users SET reset_token = ?, reset_expires = ? WHERE id = ?'
    ).run(tokenHash, expiresIso, userId);
  },

  setPassword(userId, passwordHash) {
    // tokens_valid_after = maintenant : toutes les sessions existantes sont invalidées
    getDb().prepare(`
      UPDATE users
      SET password_hash = ?, reset_token = NULL, reset_expires = NULL,
          tokens_valid_after = datetime('now')
      WHERE id = ?
    `).run(passwordHash, userId);
  },

  deductCredits(userId, amount) {
    const result = getDb().prepare(`
      UPDATE users SET credits = credits - ?
      WHERE id = ? AND credits >= ?
    `).run(amount, userId, amount);
    return result.changes > 0;
  },

  addCredits(userId, amount) {
    getDb().prepare('UPDATE users SET credits = credits + ? WHERE id = ?').run(amount, userId);
  },

  // ── Facturation / abonnement ──────────────────────────────────────────────
  updateBilling(userId, { billing_name, billing_address, billing_country, vat_number }) {
    getDb().prepare(`
      UPDATE users SET billing_name = ?, billing_address = ?, billing_country = ?, vat_number = ?
      WHERE id = ?
    `).run(billing_name ?? null, billing_address ?? null,
           (billing_country || '').toUpperCase() || null, vat_number ?? null, userId);
    return this.findById(userId);
  },

  setStripeCustomer(userId, customerId) {
    getDb().prepare('UPDATE users SET stripe_customer_id = ? WHERE id = ?').run(customerId, userId);
  },

  findByStripeCustomer(customerId) {
    return getDb().prepare('SELECT * FROM users WHERE stripe_customer_id = ?').get(customerId);
  },

  setSubscription(userId, { plan, status, periodEnd }) {
    getDb().prepare('UPDATE users SET plan = ?, sub_status = ?, period_end = ? WHERE id = ?')
      .run(plan ?? null, status ?? null, periodEnd ?? null, userId);
  },

  /**
   * Suppression RGPD (droit à l'effacement, art. 17).
   * Les FK ON DELETE CASCADE suppriment leads, sites, events, email_sequence.
   * Retourne les slugs des sites pour que l'appelant nettoie les fichiers.
   */
  deleteAccount(userId) {
    const db    = getDb();
    const slugs = db.prepare('SELECT slug FROM sites WHERE user_id = ?').all(userId).map(r => r.slug);
    db.prepare('DELETE FROM users WHERE id = ?').run(userId);
    return slugs;
  },
};
