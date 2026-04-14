import { AppError } from '../../utils/AppError.js';
import { logger } from '../../utils/logger.js';

export function errorHandler(err, req, res, next) {
  if (err instanceof AppError && err.isOperational) {
    return res.status(err.statusCode).json({
      success: false,
      error: err.message,
      code: err.code,
    });
  }

  logger.error('Unhandled error', {
    message: err.message,
    stack: err.stack,
    path: req.path,
    method: req.method,
    userId: req.userId,
  });

  const isProd = process.env.NODE_ENV === 'production';
  res.status(500).json({
    success: false,
    error: isProd ? 'Erreur interne du serveur' : err.message,
    code: 'INTERNAL_ERROR',
  });
}