import express from 'express';
import { createLead, getLeadsForUser } from '../../services/leadService.js';
import { validateLead } from '../middleware/validate.js';

const router = express.Router();

router.post('/', validateLead, async (req, res, next) => {
  try {
    const { name, activity, city, email, phone } = req.body;
    const lead = await createLead({ userId: req.userId, name, activity, city, email, phone });
    res.status(201).json({ success: true, data: lead });
  } catch (err) {
    next(err);
  }
});

router.get('/', async (req, res, next) => {
  try {
    const leads = await getLeadsForUser(req.userId);
    res.json({ success: true, data: leads });
  } catch (err) {
    next(err);
  }
});

export default router;
