import express from 'express';
import { logger } from '../../utils/logger.js';
import { authenticate } from '../middleware/auth.js';
import { isMachineOpen } from '../../services/trackingService.js';
import { config } from '../../config/config.js';
import {
  openSentParent, recentOpenExists, insertOpenEvent,
  clickRegistered, insertClickEvent, emailStats,
} from '../../db/queries.js';

const router = express.Router();

const PIXEL_GIF = Buffer.from(
  'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7',
  'base64'
);

const BOT_RE = /bot|crawler|spider|preview|prefetch|slack|telegram|whatsapp|facebook/i;

router.get('/open/:token', (req, res) => {
  res.set({
    'Content-Type':   'image/gif',
    'Cache-Control':  'no-cache, no-store, must-revalidate',
    'Pragma':         'no-cache',
    'Expires':        '0',
  });
  res.end(PIXEL_GIF);

  setImmediate(async () => {
    try {
      const ua = req.headers['user-agent'] || '';
      if (BOT_RE.test(ua)) return;

      const token  = req.params.token;
      const ip     = req.ip; // fiable grâce à trust proxy
      const parent = await openSentParent(token);
      if (!parent) return;
      if (await recentOpenExists(token, ip)) return;

      // Ouverture machine (APMP/proxy) → marquée pour exclusion du taux humain
      const machine = config.features.apmpFilter.enabled && isMachineOpen({
        sentAt: parent.created_at,
        prefetchSeconds: config.features.apmpFilter.prefetchSeconds,
        userAgent: ua,
      });

      await insertOpenEvent({ token, parent, ip, ua, machine });
    } catch (err) {
      logger.error('[Tracking] Open error', { error: err.message });
    }
  });
});

router.get('/click/:clickToken', async (req, res) => {
  const { clickToken } = req.params;
  const ip = req.ip;
  const ua = req.headers['user-agent'] || '';

  const registered = await clickRegistered(clickToken);
  if (!registered?.url) {
    return res.redirect(302, process.env.BASE_URL || 'http://localhost:3000');
  }

  setImmediate(async () => {
    try {
      await insertClickEvent({ clickToken, reg: registered, ip, ua });
    } catch (err) {
      logger.error('[Tracking] Click error', { error: err.message });
    }
  });

  res.redirect(302, registered.url);
});

// Stats protégées : données business, pas pour le public
router.get('/stats', authenticate, async (req, res, next) => {
  try {
    const parsed = parseInt(req.query.days, 10);
    const days   = Number.isFinite(parsed) ? Math.min(90, Math.max(1, parsed)) : 30;

    // emailStats filtre par tenant (JOIN sites WHERE user_id) — pas de fuite
    const { summary, byVariant } = await emailStats(req.userId, days);

    const sent = summary.sent || 0;
    const humanOpens = summary.human_opens || 0;
    res.json({
      success: true,
      data: {
        period_days:  days,
        sent,
        opens:        summary.opens   || 0,
        human_opens:  humanOpens,                 // hors APMP/proxys
        clicks:       summary.clicks  || 0,
        open_rate:        sent > 0 ? Math.round((summary.opens / sent) * 10000) / 100 : 0,
        human_open_rate:  sent > 0 ? Math.round((humanOpens / sent) * 10000) / 100 : 0,
        click_rate:       sent > 0 ? Math.round((summary.clicks / sent) * 10000) / 100 : 0,
        by_variant:   byVariant,
      },
    });
  } catch (err) {
    next(err);
  }
});

export default router;
