export class AppError extends Error {
  constructor(message, statusCode = 500, code = 'INTERNAL_ERROR') {
    super(message);
    this.statusCode   = statusCode;
    this.code         = code;
    this.isOperational = true;
  }
}

export const Errors = {
  notFound:       (msg = 'Ressource introuvable')  => new AppError(msg, 404, 'NOT_FOUND'),
  unauthorized:   (msg = 'Non autorisé')           => new AppError(msg, 401, 'UNAUTHORIZED'),
  forbidden:      (msg = 'Accès refusé')           => new AppError(msg, 403, 'FORBIDDEN'),
  badRequest:     (msg)                            => new AppError(msg, 400, 'BAD_REQUEST'),
  paymentRequired:(msg = 'Crédits insuffisants')   => new AppError(msg, 402, 'INSUFFICIENT_CREDITS'),
  conflict:       (msg)                            => new AppError(msg, 409, 'CONFLICT'),
  internal:       (msg = 'Erreur interne')         => new AppError(msg, 500, 'INTERNAL_ERROR'),
};
