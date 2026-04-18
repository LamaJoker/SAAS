import { config } from '../../config/config.js';

function createLimiter({ windowMs, max, message, keyFn }) {
  const store = new Map();
  setInterval(() => {
    const cutoff = Date.now() - windowMs;
    for (const [key, entry] of store.entries()) {
      if (entry.resetAt < cutoff) store.delete(key);
    }
  }, windowMs).unref();

  return (req, res, next) => {
    const key = keyFn ? keyFn(req) : (req.userId || req.ip);
    const now = Date.now();
    let entry = store.get(key);

    if (!entry || now > entry.resetAt) {
      entry = { count: 0, resetAt: now + windowMs };
      store.set(key, entry);
    }

    entry.count++;
    res.setHeader('X-RateLimit-Limit', max);
    res.setHeader('X-RateLimit-Remaining', Math.max(0, max - entry.count));
    res.setHeader('X-RateLimit-Reset', Math.ceil(entry.resetAt / 1000));

    if (entry.count > max) {
      return res.status(429).json({
        success: false,
        error:   message || 'Trop de requêtes, réessayez plus tard',
        code:    'RATE_LIMITED',
        retryAfter: Math.ceil((entry.resetAt - now) / 1000),
      });
    }
    next();
  };
}

export const globalLimiter = createLimiter({
  windowMs: config.rateLimit.windowMs,
  max:      config.rateLimit.maxRequests,
  message:  'Limite de requêtes atteinte',
});

export const generateLimiter = createLimiter({
  windowMs: config.rateLimit.generateWindowMs,
  max:      config.rateLimit.generateMax,
  message:  `Maximum ${config.rateLimit.generateMax} générations par heure`,
  keyFn:    req => req.userId,
});
