import express from 'express';
import { analyticsOverview } from '../../db/queries.js';
import { logger } from '../../utils/logger.js';

const router = express.Router();

router.get('/', async (req, res, next) => {
  try {
    const data = await analyticsOverview(req.userId);
    res.json({ success: true, data });
  } catch (err) {
    logger.error('Analytics error', { error: err.message });
    next(err);
  }
});

export default router;
