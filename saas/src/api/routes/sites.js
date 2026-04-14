import express from 'express';
import { getSitesForUser } from '../../services/siteService.js';
import { getCredits } from '../../services/creditService.js';

const router = express.Router();

router.get('/', async (req, res, next) => {
  try {
    const sites = await getSitesForUser(req.userId);
    res.json({ success: true, data: sites });
  } catch (err) {
    next(err);
  }
});

router.get('/credits', async (req, res, next) => {
  try {
    const credits = await getCredits(req.userId);
    res.json({ success: true, data: { credits } });
  } catch (err) {
    next(err);
  }
});

export default router;