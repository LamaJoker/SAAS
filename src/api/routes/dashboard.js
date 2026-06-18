/**
 * routes/dashboard.js — Métriques agrégées pour le dashboard business
 */
import express from 'express';
import { dashboardMetrics } from '../../db/queries.js';
import { logger } from '../../utils/logger.js';

const router = express.Router();

router.get('/', async (req, res, next) => {
  try {
    const data = await dashboardMetrics(req.userId);
    res.json({ success: true, data });
  } catch (err) {
    logger.error('Dashboard metrics error', { error: err.message });
    next(err);
  }
});

export default router;
