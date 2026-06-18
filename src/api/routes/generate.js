import express from 'express';
import { generateSiteForLead } from '../../services/siteService.js';
import { generateLimiter }     from '../middleware/rateLimiter.js';
import { validateGenerate }    from '../middleware/validate.js';
import { isValidTemplateId, DEFAULT_TEMPLATE_ID } from '../../services/templateService.js';
import { Errors } from '../../utils/AppError.js';

const router = express.Router();

router.post('/', generateLimiter, validateGenerate, async (req, res, next) => {
  try {
    const templateId = req.body.templateId ?? DEFAULT_TEMPLATE_ID;
    if (!isValidTemplateId(templateId)) {
      return next(Errors.badRequest(`templateId invalide: "${templateId}"`));
    }

    const site = await generateSiteForLead({
      userId: req.userId,
      leadId: req.body.leadId,
      templateId,
    });
    res.status(201).json({ success: true, data: site });
  } catch (err) {
    next(err);
  }
});

export default router;
