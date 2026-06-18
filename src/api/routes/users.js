import express from 'express';
import { randomBytes, createHash } from 'crypto';
import { rm }   from 'fs/promises';
import { join } from 'path';
import { repo }          from '../../db/repo.js';
import { generateToken, authenticate, revokeToken, setAuthCookie, clearAuthCookie } from '../middleware/auth.js';
import { authLimiter }   from '../middleware/rateLimiter.js';
import { Errors }        from '../../utils/AppError.js';
import { sanitizeInput } from '../../utils/utils.js';
import { hashPassword, verifyPassword, validatePasswordStrength } from '../../utils/password.js';
import { sendVerificationEmail, sendResetEmail } from '../../services/authMailService.js';
import { smtpPool }      from '../../services/smtpPool.js';
import { exportUserRelated } from '../../db/queries.js';
import { logger }        from '../../utils/logger.js';
import { config }        from '../../config/config.js';

const router = express.Router();

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function publicUser(user) {
  return {
    id: user.id, email: user.email, name: user.name,
    credits: user.credits, email_verified: !!user.email_verified,
  };
}

// L'auth navigateur passe par le cookie HttpOnly : on n'expose PAS le JWT
// dans le corps JSON (sinon il redevient lisible par du JS → on perd le
// bénéfice du HttpOnly). Les clients programmatiques (API Bearer) le
// réclament explicitement via l'en-tête `x-auth-mode: token`.
function authPayload(req, user, token) {
  const data = { user: publicUser(user) };
  if (req.get('x-auth-mode') === 'token') data.token = token;
  return data;
}

// Les tokens de vérification/reset sont stockés hashés : un dump de la DB
// ne permet pas de les rejouer.
function newToken() {
  const raw  = randomBytes(32).toString('hex');
  const hash = createHash('sha256').update(raw).digest('hex');
  return { raw, hash };
}
function hashToken(raw) {
  return createHash('sha256').update(String(raw)).digest('hex');
}

// ─── Inscription ──────────────────────────────────────────────────────────────
router.post('/register', authLimiter, async (req, res, next) => {
  try {
    const email    = sanitizeInput(req.body.email ?? '', 200).toLowerCase();
    const name     = sanitizeInput(req.body.name  ?? '', 200);
    const password = req.body.password; // jamais sanitizé : hashé, pas stocké en clair

    if (!email || !EMAIL_RE.test(email)) {
      return next(Errors.badRequest('Email invalide'));
    }

    const pwError = validatePasswordStrength(password);
    if (pwError) return next(Errors.badRequest(pwError));

    const existing = await repo.users.findByEmail(email);
    if (existing) {
      return next(Errors.conflict('Un compte existe déjà avec cet email'));
    }

    const passwordHash = await hashPassword(password);

    // Sans SMTP (dev), le compte est vérifié d'office pour ne pas bloquer le flux
    const verify = newToken();
    const user = await repo.users.create({
      email,
      name: name || email.split('@')[0],
      passwordHash,
      emailVerified: !smtpPool.isConfigured,
      verifyToken: smtpPool.isConfigured ? verify.hash : null,
    });

    if (smtpPool.isConfigured) {
      sendVerificationEmail(email, verify.raw).catch(err =>
        logger.error('[Users] Envoi email vérification échoué', { error: err.message })
      );
    }

    const token = generateToken(user.id);
    setAuthCookie(res, token);
    res.status(201).json({ success: true, data: authPayload(req, user, token) });
  } catch (err) {
    next(err);
  }
});

// ─── Vérification d'email ─────────────────────────────────────────────────────
router.get('/verify/:token', async (req, res) => {
  const user = await repo.users.findByVerifyToken(hashToken(req.params.token));
  if (!user) {
    return res.redirect('/index.html?verified=invalid');
  }
  await repo.users.markVerified(user.id);
  res.redirect('/index.html?verified=1');
});

router.post('/resend-verification', authenticate, authLimiter, async (req, res, next) => {
  try {
    const user = await repo.users.findById(req.userId);
    if (!user) return next(Errors.unauthorized());
    if (user.email_verified) {
      return res.json({ success: true, data: { already_verified: true } });
    }
    const verify = newToken();
    await repo.users.setVerifyToken(user.id, verify.hash);
    const result = await sendVerificationEmail(user.email, verify.raw);
    res.json({ success: true, data: { sent: !!result.sent } });
  } catch (err) {
    next(err);
  }
});

// ─── Mot de passe oublié ──────────────────────────────────────────────────────
router.post('/forgot', authLimiter, async (req, res, next) => {
  try {
    const email = sanitizeInput(req.body.email ?? '', 200).toLowerCase();

    // Réponse identique que le compte existe ou non (anti-énumération)
    const user = email ? await repo.users.findByEmail(email) : null;
    if (user) {
      const reset   = newToken();
      const expires = new Date(Date.now() + 3_600_000).toISOString(); // 1h
      await repo.users.setResetToken(user.id, reset.hash, expires);
      sendResetEmail(user.email, reset.raw).catch(err =>
        logger.error('[Users] Envoi email reset échoué', { error: err.message })
      );
    }

    res.json({
      success: true,
      data: { message: 'Si un compte existe avec cet email, un lien de réinitialisation a été envoyé.' },
    });
  } catch (err) {
    next(err);
  }
});

router.post('/reset', authLimiter, async (req, res, next) => {
  try {
    const { token, password } = req.body;
    if (!token || typeof token !== 'string') {
      return next(Errors.badRequest('Token manquant'));
    }
    const pwError = validatePasswordStrength(password);
    if (pwError) return next(Errors.badRequest(pwError));

    const user = await repo.users.findByResetToken(hashToken(token));
    if (!user) return next(Errors.badRequest('Lien invalide ou expiré — refaites une demande'));

    const passwordHash = await hashPassword(password);
    await repo.users.setPassword(user.id, passwordHash); // invalide aussi toutes les sessions

    res.json({ success: true, data: { message: 'Mot de passe modifié — reconnectez-vous.' } });
  } catch (err) {
    next(err);
  }
});

// ─── Connexion / déconnexion ──────────────────────────────────────────────────
router.post('/login', authLimiter, async (req, res, next) => {
  try {
    const email    = sanitizeInput(req.body.email ?? '', 200).toLowerCase();
    const password = req.body.password;

    if (!email || typeof password !== 'string') {
      return next(Errors.badRequest('Email et mot de passe requis'));
    }

    const user = await repo.users.findByEmail(email);

    // Message générique : ne révèle pas si l'email existe (anti-énumération)
    if (!user || !user.password_hash) {
      return next(Errors.unauthorized('Identifiants invalides'));
    }

    const valid = await verifyPassword(password, user.password_hash);
    if (!valid) {
      return next(Errors.unauthorized('Identifiants invalides'));
    }

    const token = generateToken(user.id);
    setAuthCookie(res, token);
    res.json({ success: true, data: authPayload(req, user, token) });
  } catch (err) {
    next(err);
  }
});

router.post('/logout', authenticate, async (req, res) => {
  await revokeToken(req.tokenJti, req.tokenExp);
  clearAuthCookie(res);
  res.json({ success: true, data: { logged_out: true } });
});

// ─── Profil ───────────────────────────────────────────────────────────────────
router.get('/me', authenticate, async (req, res, next) => {
  const user = await repo.users.findById(req.userId);
  if (!user) return next(Errors.unauthorized());
  res.json({ success: true, data: publicUser(user) });
});

// ─── Export RGPD (droit à la portabilité, art. 20) ────────────────────────────
// Renvoie TOUTES les données du compte en JSON téléchargeable, scoppé au user.
router.get('/me/export', authenticate, async (req, res, next) => {
  try {
    const uid = req.userId;
    const user = await repo.users.findById(uid);
    if (!user) return next(Errors.unauthorized());

    const { password_hash, verify_token, reset_token, tokens_valid_after, ...account } = user;
    const related = await exportUserRelated(uid);

    const data = {
      exported_at: new Date().toISOString(),
      format: 'AutoDemo RGPD export v1',
      account,
      ...related,
    };

    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="autodemo-export-${uid}.json"`);
    res.send(JSON.stringify(data, null, 2));
    logger.info('[Users] Export RGPD', { userId: uid, leads: related.leads.length });
  } catch (err) {
    next(err);
  }
});

// ─── Suppression de compte (RGPD art. 17) ─────────────────────────────────────
router.delete('/me', authenticate, async (req, res, next) => {
  try {
    const user = await repo.users.findById(req.userId);
    if (!user) return next(Errors.unauthorized());

    // Confirmation par mot de passe : un token volé ne suffit pas à tout effacer
    const valid = user.password_hash && await verifyPassword(req.body?.password ?? '', user.password_hash);
    if (!valid) return next(Errors.unauthorized('Mot de passe incorrect'));

    const slugs = await repo.users.deleteAccount(req.userId);
    await revokeToken(req.tokenJti, req.tokenExp);
    clearAuthCookie(res);

    // Nettoyage des fichiers HTML générés (hors transaction, best-effort)
    for (const slug of slugs) {
      rm(join(config.paths.output, slug), { recursive: true, force: true }).catch(() => {});
    }

    logger.info('[Users] Compte supprimé (RGPD)', { userId: req.userId, sites: slugs.length });
    res.json({ success: true, data: { deleted: true } });
  } catch (err) {
    next(err);
  }
});

export default router;
