import { Errors }        from '../../utils/AppError.js';
import { sanitizeInput } from '../../utils/utils.js';
import { config }        from '../../config/config.js';

function isValidText(str) {
  if (!str || typeof str !== 'string') return false;
  const t = str.trim();
  return t.length > 0 && t.length <= config.security.maxInputLength;
}

export function validateLead(req, res, next) {
  const { name, activity, city } = req.body;
  const errors = [];

  if (!isValidText(name))     errors.push('name requis (1-200 chars)');
  if (!isValidText(activity)) errors.push('activity requis (1-200 chars)');
  if (!isValidText(city))     errors.push('city requis (1-200 chars)');

  if (errors.length) return next(Errors.badRequest(errors.join(', ')));

  req.body.name     = sanitizeInput(name);
  req.body.activity = sanitizeInput(activity);
  req.body.city     = sanitizeInput(city);
  if (req.body.email) req.body.email = sanitizeInput(req.body.email, 100);
  if (req.body.phone) req.body.phone = sanitizeInput(req.body.phone, 30);

  next();
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function validateGenerate(req, res, next) {
  const { leadId } = req.body;
  if (!leadId || typeof leadId !== 'string' || !UUID_RE.test(leadId)) {
    return next(Errors.badRequest('leadId invalide (UUID attendu)'));
  }
  next();
}

export function validateSlug(req, res, next) {
  const { slug } = req.params;
  if (!slug || !/^[a-z0-9-]{3,120}$/.test(slug)) {
    return next(Errors.notFound('Site introuvable'));
  }
  next();
}
