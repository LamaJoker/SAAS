import express from 'express';
import { getAnalytics } from '../../services/analyticsService.js';
const router = express.Router();

router.get('/', async (req, res, next) => {
  try {
    const data = await getAnalytics();
    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
});

export default router;