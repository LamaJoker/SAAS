import { config } from '../../config/config.js';
import { logger } from '../../utils/logger.js';

/**
 * Rate limiting à store pluggable.
 *   - 'memory' (défaut) : Map en process — parfait en mono-instance.
 *   - 'redis'           : compteur partagé (INCR/PEXPIRE) — requis dès qu'il y a
 *                         plusieurs instances derrière un load-balancer.
 * Sélection : RATE_LIMIT_DRIVER=redis + REDIS_URL (npm i ioredis).
 * Fail-open : si le store tombe, on laisse passer plutôt que bloquer le trafic.
 */

function createMemoryStore() {
  const map = new Map();
  setInterval(() => {
    const now = Date.now();
    for (const [k, e] of map.entries()) if (e.resetAt <= now) map.delete(k);
  }, 60_000).unref();

  return {
    async hit(key, windowMs) {
      const now = Date.now();
      let e = map.get(key);
      if (!e || now > e.resetAt) { e = { count: 0, resetAt: now + windowMs }; map.set(key, e); }
      e.count++;
      return { count: e.count, resetAt: e.resetAt };
    },
  };
}

function createRedisStore() {
  let clientPromise = null;
  async function client() {
    if (clientPromise) return clientPromise;
    clientPromise = (async () => {
      const { default: Redis } = await import('ioredis');
      const c = new Redis(process.env.REDIS_URL || 'redis://localhost:6379', { lazyConnect: false, maxRetriesPerRequest: 2 });
      c.on('error', (err) => logger.warn('[RateLimit] Redis error', { error: err.message }));
      logger.info('[RateLimit] Store Redis actif');
      return c;
    })().catch((err) => {
      logger.error('[RateLimit] Redis indisponible — bascule mémoire', { error: err.message });
      clientPromise = null;
      throw err;
    });
    return clientPromise;
  }

  return {
    async hit(key, windowMs) {
      const c = await client();
      const k = `rl:${key}`;
      const count = await c.incr(k);
      if (count === 1) await c.pexpire(k, windowMs);
      let ttl = await c.pttl(k);
      if (ttl < 0) ttl = windowMs;
      return { count, resetAt: Date.now() + ttl };
    },
  };
}

// Store partagé par tous les limiteurs (une seule connexion Redis)
const memoryFallback = createMemoryStore();
const primaryStore = (process.env.RATE_LIMIT_DRIVER === 'redis') ? createRedisStore() : memoryFallback;

function createLimiter({ windowMs, max, message, keyFn, name }) {
  return async (req, res, next) => {
    const key = `${name}:${keyFn ? keyFn(req) : (req.userId || req.ip)}`;
    let entry;
    try {
      entry = await primaryStore.hit(key, windowMs);
    } catch {
      // Store défaillant (ex: Redis down) → fail-open via la mémoire locale
      try { entry = await memoryFallback.hit(key, windowMs); }
      catch { return next(); }
    }

    res.setHeader('X-RateLimit-Limit', max);
    res.setHeader('X-RateLimit-Remaining', Math.max(0, max - entry.count));
    res.setHeader('X-RateLimit-Reset', Math.ceil(entry.resetAt / 1000));

    if (entry.count > max) {
      return res.status(429).json({
        success: false,
        error:   message || 'Trop de requêtes, réessayez plus tard',
        code:    'RATE_LIMITED',
        retryAfter: Math.ceil((entry.resetAt - Date.now()) / 1000),
      });
    }
    next();
  };
}

export const globalLimiter = createLimiter({
  name:     'global',
  windowMs: config.rateLimit.windowMs,
  max:      config.rateLimit.maxRequests,
  message:  'Limite de requêtes atteinte',
});

export const generateLimiter = createLimiter({
  name:     'gen',
  windowMs: config.rateLimit.generateWindowMs,
  max:      config.rateLimit.generateMax,
  message:  `Maximum ${config.rateLimit.generateMax} générations par heure`,
  keyFn:    req => req.userId,
});

// Anti brute-force sur login/register : clé = IP + email ciblé
export const authLimiter = createLimiter({
  name:     'auth',
  windowMs: config.rateLimit.authWindowMs,
  max:      config.rateLimit.authMax,
  message:  'Trop de tentatives de connexion, réessayez plus tard',
  keyFn:    req => `${req.ip}:${(req.body?.email ?? '').toLowerCase()}`,
});
