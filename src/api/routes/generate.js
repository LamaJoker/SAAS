import express from 'express';
import { generateSiteForLead } from '../../services/siteService.js';
import { generateLimiter }     from '../middleware/rateLimiter.js';
import { validateGenerate }    from '../middleware/validate.js';

const router = express.Router();

router.post('/', generateLimiter, validateGenerate, async (req, res, next) => {
  try {
    const site = await generateSiteForLead({
      userId: req.userId,
      leadId: req.body.leadId,
    });
    res.status(201).json({ success: true, data: site });
  } catch (err) {
    next(err);
  }
});

export default router;
