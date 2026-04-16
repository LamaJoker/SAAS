import nodemailer from 'nodemailer';
import { logger } from '../utils/logger.js';

/**
 * Pool de transporteurs SMTP avec rotation round-robin.
 * Gère les limites horaires, la mise en quarantaine des IPs défaillantes,
 * et le reporting de bounces/spam pour auto-désactivation.
 */
export class SmtpPool {
  #transporters = [];
  #currentIndex = 0;
  #stats = new Map();

  /**
   * @param {Array<{
   *   host: string, port?: number, user: string, pass: string,
   *   senderName?: string, hourlyLimit?: number
   * }>} configs
   */
  constructor(configs) {
    if (!configs?.length) throw new Error('[SmtpPool] Aucun transporteur configuré');

    for (const cfg of configs) {
      if (!cfg.host || !cfg.user || !cfg.pass) {
        logger.warn('[SmtpPool] Config incomplète ignorée', { user: cfg.user });
        continue;
      }
      const transporter = nodemailer.createTransport({
        host: cfg.host,
        port: cfg.port ?? 587,
        secure: cfg.port === 465,
        auth: { user: cfg.user, pass: cfg.pass },
        pool: true,
        maxConnections: 3,
        maxMessages: 100,
        rateDelta: 1000,
        rateLimit: 5,
      });
      this.#transporters.push({ transporter, cfg, healthy: true, quarantineUntil: 0 });
      this.#resetStats(cfg.user);
    }

    logger.info(`[SmtpPool] Initialisé avec ${this.#transporters.length} transporteur(s)`);
  }

  #resetStats(user) {
    this.#stats.set(user, {
      sent: 0,
      bounced: 0,
      spammed: 0,
      errors: 0,
      resetAt: Date.now() + 3_600_000,
    });
  }

  #getStats(user) {
    const s = this.#stats.get(user);
    if (!s || Date.now() > s.resetAt) {
      this.#resetStats(user);
      return this.#stats.get(user);
    }
    return s;
  }

  /**
   * Vérifie la connexion de tous les transporteurs.
   * Marque les défaillants comme unhealthy sans bloquer le démarrage.
   */
  async verify() {
    const results = await Promise.allSettled(
      this.#transporters.map(async (entry) => {
        try {
          await entry.transporter.verify();
          entry.healthy = true;
          logger.info(`[SmtpPool] ${entry.cfg.user} — connexion OK`);
        } catch (err) {
          entry.healthy = false;
          logger.warn(`[SmtpPool] ${entry.cfg.user} — connexion KO: ${err.message}`);
        }
      })
    );
    const ok = this.#transporters.filter(t => t.healthy).length;
    logger.info(`[SmtpPool] ${ok}/${this.#transporters.length} transporteur(s) actif(s)`);
    if (ok === 0) throw new Error('[SmtpPool] Aucun transporteur SMTP disponible');
    return ok;
  }

  /**
   * Sélectionne le prochain transporteur sain en round-robin.
   * Saute les IPs en quarantaine ou en limite horaire.
   */
  #pick() {
    const now = Date.now();
    const candidates = this.#transporters.filter(t => {
      if (!t.healthy) return false;
      if (t.quarantineUntil > now) return false;
      const stats = this.#getStats(t.cfg.user);
      const limit = t.cfg.hourlyLimit ?? 80;
      return stats.sent < limit;
    });

    if (!candidates.length) {
      // Tous en limite — trouver le premier qui reset le plus tôt
      const next = this.#transporters
        .filter(t => t.healthy)
        .map(t => ({ t, resetAt: this.#getStats(t.cfg.user).resetAt }))
        .sort((a, b) => a.resetAt - b.resetAt)[0];

      if (!next) throw new Error('[SmtpPool] Aucun transporteur disponible');
      const wait = Math.max(0, next.resetAt - now);
      logger.warn(`[SmtpPool] Tous les transporteurs en limite — attente ${Math.ceil(wait / 1000)}s`);
      throw Object.assign(new Error('SMTP_POOL_EXHAUSTED'), { retryAfterMs: wait });
    }

    const entry = candidates[this.#currentIndex % candidates.length];
    this.#currentIndex = (this.#currentIndex + 1) % candidates.length;
    return entry;
  }

  /**
   * Envoie un email via le prochain transporteur disponible.
   * @param {object} mailOptions — options nodemailer sans `from` (géré par le pool)
   * @returns {Promise<{messageId, sentVia}>}
   */
  async send(mailOptions) {
    const entry = this.#pick();
    const { transporter, cfg } = entry;
    const stats = this.#getStats(cfg.user);

    const from = mailOptions.from ?? `"${cfg.senderName ?? 'AutoDemo'}" <${cfg.user}>`;

    try {
      const result = await transporter.sendMail({ ...mailOptions, from });
      stats.sent++;
      logger.info(`[SmtpPool] Envoyé via ${cfg.user}`, {
        to: mailOptions.to,
        subject: mailOptions.subject?.slice(0, 60),
        messageId: result.messageId,
      });
      return { messageId: result.messageId, sentVia: cfg.user };
    } catch (err) {
      stats.errors++;
      logger.error(`[SmtpPool] Erreur ${cfg.user}`, { error: err.message, code: err.responseCode });

      // Authentification refusée ou compte suspendu → quarantaine 1h
      if (err.responseCode === 535 || err.responseCode === 550 || err.responseCode === 421) {
        entry.healthy = false;
        entry.quarantineUntil = Date.now() + 3_600_000;
        logger.error(`[SmtpPool] ${cfg.user} mis en quarantaine 1h (code ${err.responseCode})`);
        // Réessai automatique avec une autre IP si disponible
        return this.send(mailOptions);
      }

      throw err;
    }
  }

  /**
   * Signale un bounce pour une IP expéditrice.
   * Au-delà de 5% de bounce → mise en quarantaine automatique.
   * @param {string} senderUser — email de l'expéditeur (cfg.user)
   */
  reportBounce(senderUser) {
    const stats = this.#stats.get(senderUser);
    if (!stats) return;
    stats.bounced++;
    const rate = stats.bounced / Math.max(stats.sent, 1);
    logger.warn(`[SmtpPool] Bounce ${senderUser}: ${(rate * 100).toFixed(1)}% (${stats.bounced}/${stats.sent})`);
    if (rate > 0.05) {
      const entry = this.#transporters.find(t => t.cfg.user === senderUser);
      if (entry) {
        entry.healthy = false;
        entry.quarantineUntil = Date.now() + 6 * 3_600_000; // 6h
        logger.error(`[SmtpPool] ${senderUser} mis en quarantaine 6h — taux bounce critique`);
      }
    }
  }

  /**
   * Signale un spam complaint pour une IP expéditrice.
   * Au-delà de 0.1% → quarantaine immédiate 24h.
   */
  reportSpam(senderUser) {
    const stats = this.#stats.get(senderUser);
    if (!stats) return;
    stats.spammed++;
    const rate = stats.spammed / Math.max(stats.sent, 1);
    logger.warn(`[SmtpPool] Spam ${senderUser}: ${(rate * 100).toFixed(2)}%`);
    if (rate > 0.001) {
      const entry = this.#transporters.find(t => t.cfg.user === senderUser);
      if (entry) {
        entry.healthy = false;
        entry.quarantineUntil = Date.now() + 24 * 3_600_000;
        logger.error(`[SmtpPool] ${senderUser} mis en quarantaine 24h — spam complaint critique`);
      }
    }
  }

  /** Retourne l'état complet du pool pour monitoring. */
  getStats() {
    const now = Date.now();
    return this.#transporters.map(({ cfg, healthy, quarantineUntil }) => {
      const stats = this.#getStats(cfg.user);
      const inQuarantine = quarantineUntil > now;
      return {
        user: cfg.user,
        healthy: healthy && !inQuarantine,
        inQuarantine,
        quarantineRemainsMs: inQuarantine ? quarantineUntil - now : 0,
        hourlyLimit: cfg.hourlyLimit ?? 80,
        sent: stats.sent,
        bounced: stats.bounced,
        spammed: stats.spammed,
        errors: stats.errors,
        resetAt: new Date(stats.resetAt).toISOString(),
      };
    });
  }

  /** Nombre de transporteurs actuellement opérationnels. */
  get activeCount() {
    const now = Date.now();
    return this.#transporters.filter(t => t.healthy && t.quarantineUntil <= now).length;
  }
}
