import nodemailer from 'nodemailer';
import { logger }  from '../utils/logger.js';

class SmtpPool {
  #transporters = [];
  #index        = 0;
  #hourly       = new Map();
  #resetTimer   = null;

  constructor(configs) {
    if (!configs?.length) {
      logger.warn('[SmtpPool] Aucune configuration SMTP — emails désactivés');
      return;
    }

    for (const cfg of configs) {
      if (!cfg.host || !cfg.user || !cfg.pass) {
        logger.warn('[SmtpPool] Config incomplète ignorée', { user: cfg.user });
        continue;
      }
      const t = nodemailer.createTransport({
        host:   cfg.host,
        port:   cfg.port ?? 587,
        secure: cfg.port === 465,
        auth:   { user: cfg.user, pass: cfg.pass },
        pool:   true,
        maxConnections: 3,
        rateLimit: 5,
      });
      this.#transporters.push({
        t, cfg,
        healthy:        true,
        quarantineUntil: 0,
      });
      this.#hourly.set(cfg.user, { sent: 0, bounced: 0, spammed: 0 });
    }

    this.#startHourlyReset();
    logger.info(`[SmtpPool] ${this.#transporters.length} transporteur(s) initialisé(s)`);
  }

  #startHourlyReset() {
    this.#resetTimer = setInterval(() => {
      for (const [user, stats] of this.#hourly) {
        this.#hourly.set(user, { ...stats, sent: 0 });
      }
    }, 3_600_000);
    this.#resetTimer.unref();
  }

  #pick() {
    const now = Date.now();
    const available = this.#transporters.filter(e => {
      if (!e.healthy || e.quarantineUntil > now) return false;
      const stats = this.#hourly.get(e.cfg.user);
      return !stats || stats.sent < (e.cfg.hourlyLimit ?? 80);
    });

    if (!available.length) throw new Error('SMTP_POOL_EXHAUSTED');

    const entry = available[this.#index % available.length];
    this.#index = (this.#index + 1) % available.length;
    return entry;
  }

  async verify() {
    let ok = 0;
    await Promise.allSettled(this.#transporters.map(async e => {
      try {
        await e.t.verify();
        e.healthy = true;
        ok++;
        logger.info(`[SmtpPool] ${e.cfg.user} — OK`);
      } catch (err) {
        e.healthy = false;
        logger.warn(`[SmtpPool] ${e.cfg.user} — KO: ${err.message}`);
      }
    }));
    return ok;
  }

  async send(mailOptions) {
    if (!this.#transporters.length) {
      throw new Error('Aucun transporteur SMTP configuré');
    }

    const entry = this.#pick();
    const { t, cfg } = entry;
    const from = mailOptions.from ?? `"${cfg.senderName ?? 'AutoDemo'}" <${cfg.user}>`;

    try {
      const result = await t.sendMail({ ...mailOptions, from });
      const stats  = this.#hourly.get(cfg.user);
      if (stats) stats.sent++;
      logger.info('[SmtpPool] Envoyé', { to: mailOptions.to, via: cfg.user, messageId: result.messageId });
      return { messageId: result.messageId, sentVia: cfg.user };
    } catch (err) {
      const code = err.responseCode;
      if (code === 535 || code === 550 || code === 421) {
        entry.healthy        = false;
        entry.quarantineUntil = Date.now() + 3_600_000;
        logger.error(`[SmtpPool] ${cfg.user} quarantaine 1h (code ${code})`);
        return this.send(mailOptions);
      }
      throw err;
    }
  }

  reportBounce(senderUser) {
    const stats = this.#hourly.get(senderUser);
    if (!stats) return;
    stats.bounced = (stats.bounced ?? 0) + 1;
    const rate = stats.bounced / Math.max(stats.sent, 1);
    if (rate > 0.05) {
      const entry = this.#transporters.find(e => e.cfg.user === senderUser);
      if (entry) {
        entry.healthy        = false;
        entry.quarantineUntil = Date.now() + 6 * 3_600_000;
        logger.error(`[SmtpPool] ${senderUser} quarantaine 6h — bounce critique`);
      }
    }
  }

  reportSpam(senderUser) {
    const stats = this.#hourly.get(senderUser);
    if (!stats) return;
    stats.spammed = (stats.spammed ?? 0) + 1;
    const rate = stats.spammed / Math.max(stats.sent, 1);
    if (rate > 0.001) {
      const entry = this.#transporters.find(e => e.cfg.user === senderUser);
      if (entry) {
        entry.healthy        = false;
        entry.quarantineUntil = Date.now() + 24 * 3_600_000;
        logger.error(`[SmtpPool] ${senderUser} quarantaine 24h — spam critique`);
      }
    }
  }

  getStats() {
    const now = Date.now();
    return this.#transporters.map(e => {
      const stats = this.#hourly.get(e.cfg.user) ?? {};
      return {
        user:         e.cfg.user,
        healthy:      e.healthy && e.quarantineUntil <= now,
        inQuarantine: e.quarantineUntil > now,
        hourlyLimit:  e.cfg.hourlyLimit ?? 80,
        sent:         stats.sent    ?? 0,
        bounced:      stats.bounced ?? 0,
        spammed:      stats.spammed ?? 0,
      };
    });
  }

  get activeCount() {
    const now = Date.now();
    return this.#transporters.filter(e => e.healthy && e.quarantineUntil <= now).length;
  }

  get isConfigured() {
    return this.#transporters.length > 0;
  }
}

function buildConfigs() {
  if (process.env.SMTP_POOL_JSON) {
    try {
      const parsed = JSON.parse(process.env.SMTP_POOL_JSON);
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    } catch (err) {
      logger.error('[SmtpPool] SMTP_POOL_JSON invalide', { error: err.message });
    }
  }

  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_SENDER_NAME } = process.env;
  if (SMTP_HOST && SMTP_USER && SMTP_PASS) {
    return [{
      host:        SMTP_HOST,
      port:        SMTP_PORT ? parseInt(SMTP_PORT) : 587,
      user:        SMTP_USER,
      pass:        SMTP_PASS,
      senderName:  SMTP_SENDER_NAME ?? 'AutoDemo',
      hourlyLimit: 80,
    }];
  }

  return [];
}

export const smtpPool = new SmtpPool(buildConfigs());

export async function verifySmtpPool() {
  if (!smtpPool.isConfigured) {
    logger.warn('[SmtpPool] Non configuré — emails désactivés');
    return false;
  }
  try {
    const count = await smtpPool.verify();
    logger.info(`[SmtpPool] ${count} transporteur(s) actif(s)`);
    return count > 0;
  } catch (err) {
    logger.error('[SmtpPool] Vérification échouée', { error: err.message });
    return false;
  }
}
