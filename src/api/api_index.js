import express from 'express';
import { join, resolve } from 'path';
import { existsSync } from 'fs';
import { runMigrations } from '../db/database.js';
import { User } from '../db/models/User.js';
import { Site } from '../db/models/Site.js';
import leadsRouter from './routes/leads.js';
import generateRouter from './routes/generate.js';
import sitesRouter from './routes/sites.js';
import dashboardRouter from './routes/dashboard.js';
import resendRouter from './routes/resend.js';
import { globalLimiter } from './middleware/rateLimiter.js';
import { errorHandler } from './middleware/errorHandler.js';
import { validateSlug } from './middleware/validate.js';
import { Errors } from '../utils/AppError.js';
import { logger } from '../utils/logger.js';
import { config } from '../config/config.js';

const app = express();

app.disable('x-powered-by');
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  next();
});

app.use(express.json({ limit: '10kb' }));
app.use(globalLimiter);

app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    logger.info(`${req.method} ${req.path}`, {
      status: res.statusCode,
      ms: Date.now() - start,
      userId: req.userId,
    });
  });
  next();
});

// ── Public routes ─────────────────────────────────────────────────────────────

app.get('/demos/:slug', validateSlug, (req, res, next) => {
  const { slug } = req.params;
  const site = Site.findBySlug(slug);
  if (!site) return next(Errors.notFound('Site introuvable'));

  const outputRoot = resolve(config.paths.output);
  const filePath = resolve(join(outputRoot, slug, 'index.html'));

  if (!filePath.startsWith(outputRoot)) return next(Errors.forbidden('Accès interdit'));
  if (!existsSync(filePath)) return next(Errors.notFound('Fichier de site introuvable'));

  try { Site.incrementViews(site.id); } catch {}

  res.setHeader('Cache-Control', 'public, max-age=300');
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.sendFile(filePath);
});

app.post('/users', async (req, res, next) => {
  try {
    const { email, name } = req.body;
    if (!email || typeof email !== 'string' || !email.includes('@')) {
      return next(Errors.badRequest('Email invalide'));
    }
    const existing = User.findByEmail(email.trim().toLowerCase());
    if (existing) return next(Errors.conflict('Email déjà utilisé'));
    const user = User.create({ email: email.trim().toLowerCase(), name });
    res.status(201).json({ success: true, data: user });
  } catch (err) {
    next(err);
  }
});

// ── Auth middleware ────────────────────────────────────────────────────────────

app.use((req, res, next) => {
  const userId = req.headers['x-user-id'];
  if (!userId) return next(Errors.unauthorized('x-user-id header requis'));
  const user = User.findById(userId);
  if (!user) return next(Errors.unauthorized('Utilisateur inconnu'));
  req.userId = userId;
  req.user = user;
  next();
});

// ── Protected routes ──────────────────────────────────────────────────────────

app.use('/leads', leadsRouter);
app.use('/generate', generateRouter);
app.use('/sites', sitesRouter);
app.use('/dashboard', dashboardRouter);
app.use('/resend', resendRouter);

app.get('/health', (req, res) => {
  res.json({ status: 'ok', env: config.server.env, ts: new Date().toISOString() });
});

app.use((req, res, next) => next(Errors.notFound('Route introuvable')));
app.use(errorHandler);

export function startServer() {
  runMigrations();
  app.listen(config.server.port, () => {
    logger.info('Serveur démarré', {
      port: config.server.port,
      env: config.server.env,
      baseUrl: config.server.baseUrl,
    });
  });
}

export default app;
