import jwt from 'jsonwebtoken';
import { User } from '../../db/models/User.js';
import { Errors } from '../../utils/AppError.js';
import { logger } from '../../utils/logger.js';

const SECRET = process.env.JWT_SECRET;
const REFRESH_SECRET = process.env.JWT_REFRESH_SECRET ?? `${process.env.JWT_SECRET}_refresh`;

if (!SECRET) {
  throw new Error('JWT_SECRET manquant dans .env — ajoutez une clé aléatoire d\'au moins 32 caractères');
}

/**
 * Middleware d'authentification JWT.
 * Remplace l'ancien header x-user-id non sécurisé.
 *
 * Usage : app.use('/leads', authMiddleware, leadsRouter)
 *
 * Le token doit être envoyé dans le header :
 *   Authorization: Bearer <token>
 */
export function authMiddleware(req, res, next) {
  const header = req.headers['authorization'];

  if (!header?.startsWith('Bearer ')) {
    return next(Errors.unauthorized('Token manquant — Authorization: Bearer <token> requis'));
  }

  const token = header.slice(7).trim();

  try {
    const payload = jwt.verify(token, SECRET);

    // Vérification en base (détecte les comptes supprimés entre deux requêtes)
    const user = User.findById(payload.sub);
    if (!user) return next(Errors.unauthorized('Utilisateur introuvable'));

    req.userId = user.id;
    req.user = user;
    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return next(Errors.unauthorized('Token expiré — reconnectez-vous'));
    }
    if (err.name === 'JsonWebTokenError') {
      return next(Errors.unauthorized('Token invalide'));
    }
    logger.error('Auth middleware error', { error: err.message });
    next(Errors.unauthorized());
  }
}

/**
 * Génère un access token (courte durée) et un refresh token (longue durée).
 * @param {string} userId
 * @returns {{ accessToken: string, refreshToken: string, expiresIn: number }}
 */
export function generateTokens(userId) {
  const expiresIn = parseInt(process.env.JWT_EXPIRES_IN ?? '86400'); // 24h par défaut
  const accessToken = jwt.sign({ sub: userId }, SECRET, { expiresIn });
  const refreshToken = jwt.sign({ sub: userId, type: 'refresh' }, REFRESH_SECRET, {
    expiresIn: parseInt(process.env.JWT_REFRESH_EXPIRES_IN ?? '2592000'), // 30j
  });
  return { accessToken, refreshToken, expiresIn };
}

/**
 * Vérifie un refresh token et retourne le userId.
 * @param {string} token
 * @returns {string} userId
 */
export function verifyRefreshToken(token) {
  try {
    const payload = jwt.verify(token, REFRESH_SECRET);
    if (payload.type !== 'refresh') throw new Error('Type de token invalide');
    return payload.sub;
  } catch {
    throw Errors.unauthorized('Refresh token invalide ou expiré');
  }
}

/**
 * Routes d'authentification à monter dans l'app Express.
 * À appeler une fois dans src/api/index.js :
 *   mountAuthRoutes(app)
 *
 * POST /auth/login   → { email } → { accessToken, refreshToken, user }
 * POST /auth/refresh → { refreshToken } → { accessToken }
 * POST /auth/logout  → (stateless — côté client on supprime le token)
 */
export function mountAuthRoutes(app) {
  app.post('/auth/login', async (req, res, next) => {
    try {
      const { email, name } = req.body;
      if (!email || typeof email !== 'string' || !email.includes('@')) {
        return next(Errors.badRequest('Email invalide'));
      }

      const normalizedEmail = email.trim().toLowerCase();
      let user = User.findByEmail(normalizedEmail);

      // Création automatique si nouvel utilisateur (magic link simplifié)
      if (!user) {
        user = User.create({
          email: normalizedEmail,
          name: name?.trim() || normalizedEmail.split('@')[0],
        });
        logger.info('Nouvel utilisateur créé', { userId: user.id, email: normalizedEmail });
      }

      const { accessToken, refreshToken, expiresIn } = generateTokens(user.id);

      res.json({
        success: true,
        data: {
          accessToken,
          refreshToken,
          expiresIn,
          user: { id: user.id, email: user.email, name: user.name, credits: user.credits },
        },
      });
    } catch (err) {
      next(err);
    }
  });

  app.post('/auth/refresh', (req, res, next) => {
    try {
      const { refreshToken } = req.body;
      if (!refreshToken) return next(Errors.badRequest('refreshToken requis'));

      const userId = verifyRefreshToken(refreshToken);
      const user = User.findById(userId);
      if (!user) return next(Errors.unauthorized('Utilisateur introuvable'));

      const tokens = generateTokens(userId);
      res.json({ success: true, data: { accessToken: tokens.accessToken, expiresIn: tokens.expiresIn } });
    } catch (err) {
      next(err);
    }
  });

  // Stateless logout — le client supprime ses tokens
  app.post('/auth/logout', (req, res) => {
    res.json({ success: true, message: 'Déconnecté — supprimez vos tokens côté client' });
  });
}
