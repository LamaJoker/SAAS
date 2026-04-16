import express from 'express';
import { join, resolve } from 'path';
import { existsSync } from 'fs';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { runMigrations, getDb } from '../db/database.js';
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
const JWT_SECRET = process.env.JWT_SECRET;

app.disable('x-powered-by');
app.use(express.json({ limit: '10kb' }));
app.use(globalLimiter);

// ── Public Routes ────────────────────────────────────────────────────────────

// Login via Email
app.post('/auth/login', (req, res, next) => {
  const { email } = req.body;
  if (!email?.includes('@')) return next(Errors.badRequest('Email requis'));
  
  let user = User.findByEmail(email.toLowerCase().trim());
  if (!user) {
    user = User.create({ email: email.toLowerCase().trim(), name: email.split('@')[0] });
  }
  
  const token = jwt.sign({ sub: user.id }, JWT_SECRET, { expiresIn: '30d' });
  res.json({ success: true, token, user });
});

// Pixel de tracking (Appelé par les sites démo)
app.get('/t/:slug', (req, res) => {
  const site = Site.findBySlug(req.params.slug);
  if (site) {
    Site.incrementViews(site.id);
    getDb().prepare("INSERT INTO events (id, type, site_id, meta) VALUES (?, 'view', ?, ?)")
      .run(crypto.randomUUID(), site.id, JSON.stringify({ ua: req.headers['user-agent'] }));
  }
  const pixel = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');
  res.writeHead(200, { 'Content-Type': 'image/gif', 'Cache-Control': 'no-store' }).end(pixel);
});

// Désabonnement
app.get('/unsubscribe/:token', (req, res) => {
  const email = Buffer.from(req.params.token, 'base64').toString();
  getDb().prepare("UPDATE users SET unsubscribed = 1 WHERE email = ?").run(email);
  res.send('<html><body><h1>Désinscrit avec succès.</h1></body></html>');
});

// Middleware d'authentification JWT
const auth = (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return next(Errors.unauthorized());
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.userId = decoded.sub;
    next();
  } catch { next(Errors.unauthorized()); }
};

// ── Protected Routes ──────────────────────────────────────────────────────────

app.use('/leads', auth, leadsRouter);
app.use('/generate', auth, generateRouter);
app.use('/sites', auth, sitesRouter);
app.use('/dashboard', auth, dashboardRouter);

app.use(errorHandler);

export function startServer() {
  runMigrations();
  app.listen(config.server.port, () => logger.info(`Serveur OK sur port ${config.server.port}`));
}