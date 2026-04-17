/**
 * smtpManager.js — Rotation SMTP multi-comptes avec warmup progressif
 *
 * Stratégie :
 *   - Pool de comptes SMTP chargés depuis env ou config
 *   - Chaque compte a un quota horaire et un état (actif / refroidi / blacklisté)
 *   - Warmup : augmentation progressive du volume par compte
 *   - Fallback automatique si un compte dépasse son quota
 *
 * Config attendue (env) :
 *   SMTP_ACCOUNTS = JSON array : [{"host":"...","port":587,"user":"...","pass":"...","from":"..."}]
 *   ou variables individuelles SMTP_HOST, SMTP_USER, SMTP_PASS, SMTP_FROM
 */

import nodemailer from 'nodemailer';
import { logger }  from '../utils/logger.js';

// ─── Warmup schedule ─────────────────────────────────────────────────────────
// Jour 1-3 : 20/h, Jour 4-7 : 50/h, Semaine 2 : 100/h, Semaine 3+ : 200/h
function warmupLimit(accountCreatedAt) {
  const days = Math.floor((Date.now() - new Date(accountCreatedAt).getTime()) / 86_400_000);
  if (days < 3)  return 20;
  if (days < 7)  return 50;
  if (days < 14) return 100;
  return 200;
}

// ─── Parse SMTP accounts ──────────────────────────────────────────────────────
function loadAccounts() {
  try {
    const raw = process.env.SMTP_ACCOUNTS;
    if (raw) {
      const accounts = JSON.parse(raw);
      return accounts.map((a, i) => ({
        id:          `account_${i}`,
        host:        a.host,
        port:        parseInt(a.port || '587'),
        user:        a.user,
        pass:        a.pass,
        from:        a.from || a.user,
        senderName:  a.senderName || process.env.SMTP_SENDER_NAME || 'AutoDemo',
        createdAt:   a.createdAt || new Date(Date.now() - 30 * 86_400_000).toISOString(), // assume 30j si absent
        sentThisHour:   0,
        sentTotal:      0,
        lastResetAt:    Date.now(),
        blacklisted:    false,
        blacklistedAt:  null,
        transporter:    null,
      }));
    }
  } catch (e) {
    logger.warn('[SmtpManager] Failed to parse SMTP_ACCOUNTS, falling back to single account');
  }

  // Fallback : compte unique
  const host = process.env.SMTP_HOST;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  if (!host || !user || !pass) return [];

  return [{
    id:           'default',
    host,
    port:         parseInt(process.env.SMTP_PORT || '587'),
    user,
    pass,
    from:         process.env.SMTP_FROM || user,
    senderName:   process.env.SMTP_SENDER_NAME || 'AutoDemo',
    createdAt:    new Date(Date.now() - 30 * 86_400_000).toISOString(),
    sentThisHour:   0,
    sentTotal:      0,
    lastResetAt:    Date.now(),
    blacklisted:    false,
    blacklistedAt:  null,
    transporter:    null,
  }];
}

// ─── Manager ──────────────────────────────────────────────────────────────────
class SmtpManager {
  constructor() {
    this.accounts = loadAccounts();
    this._startHourlyReset();
    logger.info(`[SmtpManager] Loaded ${this.accounts.length} SMTP account(s)`);
  }

  // Réinitialise les compteurs horaires chaque heure
  _startHourlyReset() {
    setInterval(() => {
      for (const a of this.accounts) {
        a.sentThisHour = 0;
        a.lastResetAt  = Date.now();
      }
      logger.debug('[SmtpManager] Hourly counters reset');
    }, 3_600_000).unref();
  }

  // Crée (ou retourne) le transporter pour un compte
  async _getTransporter(account) {
    if (account.transporter) return account.transporter;

    const t = nodemailer.createTransport({
      host:   account.host,
      port:   account.port,
      secure: account.port === 465,
      auth:   { user: account.user, pass: account.pass },
      pool:   true,
      maxConnections: 3,
      rateLimit: 10, // max 10 msg/sec par connexion
    });

    await t.verify();
    account.transporter = t;
    return t;
  }

  // Sélectionne le meilleur compte disponible
  _pickAccount() {
    const available = this.accounts.filter(a => {
      if (a.blacklisted) return false;
      const limit = warmupLimit(a.createdAt);
      return a.sentThisHour < limit;
    });

    if (!available.length) return null;

    // Priorité : compte avec le moins d'envois cette heure
    available.sort((a, b) => a.sentThisHour - b.sentThisHour);
    return available[0];
  }

  /**
   * Envoie un email via le meilleur compte disponible.
   * @returns {{ account: string, messageId: string }}
   */
  async send({ to, subject, text, html, replyTo, headers = {} }) {
    const account = this._pickAccount();
    if (!account) {
      throw new Error('No SMTP account available (all quota reached or blacklisted)');
    }

    let transporter;
    try {
      transporter = await this._getTransporter(account);
    } catch (err) {
      logger.error(`[SmtpManager] Account ${account.id} verify failed: ${err.message}`);
      account.blacklisted   = true;
      account.blacklistedAt = new Date().toISOString();
      account.transporter   = null;
      return this.send({ to, subject, text, html, replyTo, headers }); // retry next account
    }

    const messageId = `<${Date.now().toString(36)}.${Math.random().toString(36).slice(2)}@${account.host}>`;

    try {
      const result = await transporter.sendMail({
        from:      `"${account.senderName}" <${account.from}>`,
        to,
        subject,
        text,
        html,
        replyTo:   replyTo || account.from,
        messageId,
        headers: {
          'X-Mailer':     'AutoDemo/1.0',
          'X-Account':    account.id,
          'List-Unsubscribe': `<mailto:${account.from}?subject=Désabonnement>`,
          ...headers,
        },
      });

      account.sentThisHour++;
      account.sentTotal++;

      logger.info(`[SmtpManager] Sent via ${account.id} (${account.sentThisHour}/${warmupLimit(account.createdAt)} this hour)`, {
        to, messageId: result.messageId,
      });

      return { account: account.id, messageId: result.messageId || messageId };

    } catch (err) {
      // Détection blacklist ou auth failure
      const msg = err.message.toLowerCase();
      if (msg.includes('blacklist') || msg.includes('blocked') || msg.includes('banned') ||
          msg.includes('auth') || msg.includes('credentials')) {
        logger.error(`[SmtpManager] Account ${account.id} appears blacklisted: ${err.message}`);
        account.blacklisted   = true;
        account.blacklistedAt = new Date().toISOString();
        account.transporter   = null;
        return this.send({ to, subject, text, html, replyTo, headers }); // retry
      }
      throw err;
    }
  }

  /** Stats pour monitoring */
  getStats() {
    return this.accounts.map(a => ({
      id:           a.id,
      from:         a.from,
      sentThisHour: a.sentThisHour,
      sentTotal:    a.sentTotal,
      limit:        warmupLimit(a.createdAt),
      blacklisted:  a.blacklisted,
      available:    !a.blacklisted && a.sentThisHour < warmupLimit(a.createdAt),
    }));
  }

  /** Débloquer manuellement un compte */
  unblacklist(accountId) {
    const a = this.accounts.find(a => a.id === accountId);
    if (a) { a.blacklisted = false; a.blacklistedAt = null; a.transporter = null; }
  }
}

// Singleton
export const smtpManager = new SmtpManager();
