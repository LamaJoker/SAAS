import express        from 'express';
import cors           from 'cors';
import { authenticate, requireVerified, requireAdmin } from './middleware/auth.js';
import { globalLimiter } from './middleware/rateLimiter.js';
import { errorHandler }  from './middleware/errorHandler.js';
import { logger }        from '../utils/logger.js';

import usersRoutes       from './routes/users.js';
import leadsRoutes       from './routes/leads.js';
import sitesRoutes       from './routes/sites.js';
import generateRoutes    from './routes/generate.js';
import analyticsRoutes   from './routes/analytics.js';
import trackingRoutes    from './routes/tracking.js';
import queueRoutes       from './routes/queue.js';
import resendRoutes      from './routes/resend.js';
import unsubscribeRoutes from './routes/unsubscribe.js';
import demosRoutes       from './routes/demos.js';
import healthRoutes      from './routes/health.js';
import dashboardRoutes   from './routes/dashboard.js';
import templatesRoutes   from './routes/templates.js';
import contactRoutes     from './routes/contact.js';
import scrapeRoutes      from './routes/scrape.js';
import billingRoutes, { stripeWebhookHandler } from './routes/billing.js';
import crmRoutes         from './routes/crm.js';
import inboundRoutes     from './routes/inbound.js';
import featuresRoutes    from './routes/features.js';
import legalRoutes       from './routes/legal.js';

import { config, validateConfig } from '../config/config.js';
import { runMigrations }          from '../db/database.js';
import { startAllWorkers, stopAllWorkers } from '../workers/index.js';
import { startSequenceWorker }    from '../workers/sequenceWorker.js';
import { startInboundPoller, stopInboundPoller } from '../workers/inboundPoller.js';
import { startBackupScheduler }   from '../services/backupService.js';
import { startRetentionScheduler } from '../services/retentionService.js';
import { startPrivacyScheduler } from '../services/prospectPrivacyService.js';
import { requestId }             from './middleware/requestId.js';
import { usesDemoHost }          from '../utils/demoUrl.js';
import { join } from 'path';

export function createApp() {
  const app = express();

  // Derrière un reverse proxy (nginx, Caddy, Cloudflare) : req.ip lit X-Forwarded-For
  // de manière fiable au lieu de faire confiance aveuglément au header.
  app.set('trust proxy', 1);
  app.disable('x-powered-by');

  // CORS strict : uniquement les origines listées dans CORS_ORIGIN.
  // Liste vide = aucun en-tête CORS (les requêtes same-origin fonctionnent toujours).
  app.use(cors({
    origin: config.cors.origins.length ? config.cors.origins : false,
    credentials: true,
  }));

  // En-têtes de sécurité de base (équivalent helmet minimal, sans dépendance)
  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    next();
  });

  // Webhook Stripe AVANT express.json : la vérification de signature exige le corps brut
  app.post('/billing/webhook', express.raw({ type: 'application/json' }), stripeWebhookHandler);

  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: false }));

  // Parsing minimal des cookies (auth par cookie HttpOnly) — sans dépendance
  app.use((req, res, next) => {
    req.cookies = {};
    const raw = req.headers.cookie;
    if (raw) {
      for (const part of raw.split(';')) {
        const i = part.indexOf('=');
        if (i === -1) continue;
        const k = part.slice(0, i).trim();
        if (k) req.cookies[k] = decodeURIComponent(part.slice(i + 1).trim());
      }
    }
    next();
  });

  app.use(requestId);

  // Domaine dédié aux démos : `demos.mon-saas.fr/plombier-durand` est réécrit en
  // `/demos/plombier-durand`. Un seul segment, au format slug, en GET : tout le
  // reste (assets, /contact, /track, /unsubscribe appelés depuis la page démo)
  // passe sans modification. Inactif tant que DEMO_HOST n'est pas configuré,
  // donc aucun changement de comportement par défaut.
  if (usesDemoHost()) {
    const demoHost = config.server.demoHost.trim().toLowerCase();
    app.use((req, res, next) => {
      if (req.method === 'GET' && req.hostname?.toLowerCase() === demoHost) {
        const m = req.path.match(/^\/([a-z0-9][a-z0-9-]{2,120})$/);
        if (m) req.url = `/demos/${m[1]}`;
      }
      next();
    });
  }

  app.use((req, res, next) => {
    const start = Date.now();
    res.on('finish', () => {
      logger.info(`${req.method} ${req.path} ${res.statusCode} ${Date.now() - start}ms`, {
        userId: req.userId, reqId: req.id,
      });
    });
    next();
  });

  app.use(globalLimiter);

  // CSP dédiée au frontend : réduit le rayon d'une éventuelle injection.
  // connect-src 'self' empêche l'exfiltration vers un domaine tiers ;
  // object/base/frame-ancestors verrouillés. Les styles/scripts inline du
  // dashboard sont autorisés (page first-party), Google Fonts whitelistée.
  app.use((req, res, next) => {
    if (req.path === '/' || req.path.endsWith('.html')) {
      res.setHeader('Content-Security-Policy', [
        "default-src 'self'",
        "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
        "font-src 'self' https://fonts.gstatic.com",
        "img-src 'self' data:",
        "script-src 'self'", // scripts externalisés → plus de 'unsafe-inline' : un <script> injecté ne s'exécute pas
        "connect-src 'self'",
        "form-action 'self'",
        "base-uri 'none'",
        "object-src 'none'",
        "frame-ancestors 'none'",
      ].join('; '));
    }
    next();
  });

  // Routing explicite : "/" sert la landing marketing, "/login" et "/register" servent la page auth.
  // Ces routes passent AVANT express.static pour éviter que index.html soit servi à la racine.
  app.get('/', (req, res) => res.sendFile(join(config.paths.root, 'frontend', 'landing.html')));
  app.get(['/login', '/register'], (req, res) => res.sendFile(join(config.paths.root, 'frontend', 'index.html')));

  // Frontend (login + dashboard) servi par la même origine — pas besoin de CORS
  app.use(express.static(join(config.paths.root, 'frontend')));

  // Public routes — no auth needed
  app.use('/health',       healthRoutes);
  app.use('/users',        usersRoutes);
  app.use('/track',        trackingRoutes);
  app.use('/unsubscribe',  unsubscribeRoutes);
  app.use('/demos',        demosRoutes);
  app.use('/contact',      contactRoutes);
  app.use('/billing',      billingRoutes); // /packs public, /checkout protégé en interne
  app.use('/crm',          crmRoutes);     // actions un-clic, protégées par token HMAC
  app.use('/inbound',      inboundRoutes); // réponses entrantes, protégées par secret URL
  app.use('/legal',        legalRoutes);   // mentions, confidentialité, CGV (public)

  // Protected routes — JWT required
  app.use('/leads',      authenticate, leadsRoutes);
  app.use('/sites',      authenticate, sitesRoutes);
  app.use('/generate',   authenticate, requireVerified, generateRoutes);
  app.use('/analytics',  authenticate, analyticsRoutes);
  app.use('/resend',     authenticate, resendRoutes);
  app.use('/queue',      authenticate, requireAdmin, queueRoutes); // ops/infra : admin only
  app.use('/dashboard',  authenticate, dashboardRoutes);
  app.use('/features',   authenticate, featuresRoutes);
  app.use('/templates',  authenticate, templatesRoutes);
  app.use('/scrape',     authenticate, requireVerified, scrapeRoutes);

  // 404 JSON propre pour toute route inconnue
  app.use((req, res) => {
    res.status(404).json({ success: false, error: 'Route introuvable', code: 'NOT_FOUND' });
  });

  app.use(errorHandler);

  return app;
}

export function startServer() {
  validateConfig();   // refuse de démarrer avec une config invalide
  runMigrations();    // schéma toujours à jour avant d'accepter du trafic

  const app  = createApp();
  const port = config.server.port;

  const server = app.listen(port, () => {
    logger.info(`Serveur démarré sur le port ${port} [${config.server.env}]`);
  });

  // Workers de queue (scrape/generate/email) + séquence email périodique
  startAllWorkers();
  startSequenceWorker();
  // Poller IMAP des réponses entrantes (dormant si non configuré)
  startInboundPoller().catch(() => {});
  startBackupScheduler(); // backup SQLite quotidien (data/backups/, 7 conservés)
  startRetentionScheduler(); // agrégation + purge des events (RETENTION_DAYS)
  startPrivacyScheduler();   // démos des désinscrits + leads périmés (LEAD_RETENTION_DAYS)

  // Arrêt gracieux : termine les requêtes et les jobs en cours avant de quitter
  const shutdown = async (signal) => {
    logger.info(`${signal} reçu — arrêt gracieux...`);
    try { stopInboundPoller(); } catch {}
    try { await stopAllWorkers(); } catch {}
    server.close(() => {
      logger.info('Serveur arrêté proprement');
      process.exit(0);
    });
    // Filet de sécurité si des connexions traînent
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT',  () => shutdown('SIGINT'));

  return app;
}
