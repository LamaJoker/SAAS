import jwt from 'jsonwebtoken';
import { randomUUID } from 'crypto';
import { Errors } from '../../utils/AppError.js';
import { config } from '../../config/config.js';
import { repo }   from '../../db/repo.js';
import { isTokenRevoked, revokeJti } from '../../db/queries.js';

const COOKIE_NAME = 'authToken';

/** Pose le JWT dans un cookie HttpOnly (inaccessible au JS → immunisé XSS). */
export function setAuthCookie(res, token) {
  const maxAgeSec = 30 * 24 * 3600; // 30 jours
  const parts = [
    `${COOKIE_NAME}=${token}`,
    'HttpOnly',
    'Path=/',
    'SameSite=Lax',                  // bloque l'envoi cross-site (anti-CSRF)
    `Max-Age=${maxAgeSec}`,
  ];
  if (config.server.env === 'production') parts.push('Secure');
  res.append('Set-Cookie', parts.join('; '));
}

export function clearAuthCookie(res) {
  res.append('Set-Cookie', `${COOKIE_NAME}=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0`);
}

export async function authenticate(req, res, next) {
  // Cookie HttpOnly en priorité (frontend) ; en-tête Bearer en repli (API, tests)
  const cookieToken = req.cookies?.[COOKIE_NAME];
  const header = req.headers.authorization;
  const headerToken = header?.startsWith('Bearer ') ? header.slice(7) : null;
  const token = cookieToken || headerToken;

  if (!token) {
    return next(Errors.unauthorized('Token manquant'));
  }
  try {
    const payload = jwt.verify(token, config.security.jwtSecret);

    // Token explicitement révoqué (logout)
    if (payload.jti && await isTokenRevoked(payload.jti)) {
      return next(Errors.unauthorized('Session terminée'));
    }

    // Tokens émis avant un reset de mot de passe : tous invalidés d'un coup
    const user = await repo.users.findById(payload.userId);
    if (!user) return next(Errors.unauthorized('Compte introuvable'));
    if (user.tokens_valid_after && payload.iat * 1000 < new Date(user.tokens_valid_after).getTime()) {
      return next(Errors.unauthorized('Session expirée — reconnectez-vous'));
    }

    req.userId   = payload.userId;
    req.tokenJti = payload.jti ?? null;
    req.tokenExp = payload.exp ?? null;
    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') return next(Errors.unauthorized('Token expiré'));
    next(Errors.unauthorized('Token invalide'));
  }
}

/**
 * Exige une adresse email vérifiée (à placer après authenticate).
 * Protège les actions coûteuses : génération de sites, scraping.
 */
export async function requireVerified(req, res, next) {
  try {
    const user = await repo.users.findById(req.userId);
    if (!user?.email_verified) {
      return next(Errors.forbidden('Vérifiez votre adresse email pour utiliser cette fonctionnalité (email de confirmation envoyé à l\'inscription)'));
    }
    next();
  } catch (err) { next(err); }
}

/**
 * Réserve une route aux comptes admin (à placer après authenticate).
 * Surfaces d'exploitation : /queue/*, /health/details — ne doivent jamais
 * exposer les jobs/infra de tous les tenants à un utilisateur normal.
 */
export async function requireAdmin(req, res, next) {
  try {
    const user = await repo.users.findById(req.userId);
    if (!user?.is_admin) {
      return next(Errors.forbidden('Accès réservé aux administrateurs'));
    }
    next();
  } catch (err) { next(err); }
}

export function generateToken(userId) {
  return jwt.sign({ userId, jti: randomUUID() }, config.security.jwtSecret, {
    expiresIn: config.security.jwtExpiry,
  });
}

/** Révoque un token (logout). Purge au passage les révocations expirées. */
export async function revokeToken(jti, exp) {
  if (!jti) return;
  const expiresAt = exp
    ? new Date(exp * 1000).toISOString()
    : new Date(Date.now() + 30 * 86_400_000).toISOString();
  await revokeJti(jti, expiresAt);
}
