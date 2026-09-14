import { AppError } from '../../utils/AppError.js';
import { logger }    from '../../utils/logger.js';
import { reportError } from '../../utils/errorReporter.js';

// Express identifie un middleware d'erreur à son arité de 4 : retirer `next`
// le transformerait en middleware ordinaire et casserait la gestion d'erreurs.
// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, next) {
  if (err instanceof AppError && err.isOperational) {
    return res.status(err.statusCode).json({
      success: false,
      error:   err.message,
      code:    err.code,
    });
  }

  logger.error('Unhandled error', {
    message: err.message,
    stack:   err.stack,
    path:    req.path,
    method:  req.method,
    userId:  req.userId,
    reqId:   req.id,
  });
  // Erreur non opérationnelle (bug) → alerte le webhook si configuré
  reportError(`${req.method} ${req.path}`, err);

  const isProd = process.env.NODE_ENV === 'production';
  res.status(500).json({
    success: false,
    error:   isProd ? 'Erreur interne du serveur' : err.message,
    code:    'INTERNAL_ERROR',
    // Donné au client pour qu'un signalement pointe directement la bonne ligne
    // de log : un grep au lieu d'une recherche à l'heure approximative.
    requestId: req.id,
  });
}
