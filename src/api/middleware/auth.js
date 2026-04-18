import jwt from 'jsonwebtoken';
import { Errors } from '../../utils/AppError.js';
import { config } from '../../config/config.js';

export function authenticate(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return next(Errors.unauthorized('Token manquant'));
  }
  const token = header.slice(7);
  try {
    const payload = jwt.verify(token, config.security.jwtSecret);
    req.userId = payload.userId;
    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') return next(Errors.unauthorized('Token expiré'));
    next(Errors.unauthorized('Token invalide'));
  }
}

export function generateToken(userId) {
  return jwt.sign({ userId }, config.security.jwtSecret, {
    expiresIn: config.security.jwtExpiry,
  });
}
