import express        from 'express';
import cors           from 'cors';
import { authenticate }  from './middleware/auth.js';
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
import quickDemoRoutes   from './routes/quickDemo.js';

import { config } from '../config/config.js';

export function createApp() {
  const app = express();

  app.use(cors({
    origin: process.env.CORS_ORIGIN?.split(',') ?? '*',
    credentials: true,
  }));
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: false }));

  app.use((req, res, next) => {
    const start = Date.now();
    res.on('finish', () => {
      logger.info(`${req.method} ${req.path} ${res.statusCode} ${Date.now() - start}ms`, {
        userId: req.userId,
      });
    });
    next();
  });

  app.use(globalLimiter);

  // Public routes — no auth needed
  app.use('/health',       healthRoutes);
  app.use('/users',        usersRoutes);
  app.use('/track',        trackingRoutes);
  app.use('/unsubscribe',  unsubscribeRoutes);
  app.use('/demos',        demosRoutes);

  // Protected routes — JWT required
  app.use('/leads',      authenticate, leadsRoutes);
  app.use('/sites',      authenticate, sitesRoutes);
  app.use('/generate',   authenticate, generateRoutes);
  app.use('/analytics',  authenticate, analyticsRoutes);
  app.use('/resend',     authenticate, resendRoutes);
  app.use('/queue',      authenticate, queueRoutes);
  app.use('/quick-demo', authenticate, quickDemoRoutes);

  app.use(errorHandler);

  return app;
}

export function startServer() {
  const app  = createApp();
  const port = config.server.port;

  app.listen(port, () => {
    logger.info(`Serveur démarré sur le port ${port} [${config.server.env}]`);
  });

  return app;
}
