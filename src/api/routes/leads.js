import express from 'express';
import { Lead }         from '../../db/models/Lead.js';
import { Errors }       from '../../utils/AppError.js';
import { validateLead } from '../middleware/validate.js';

const router = express.Router();

router.post('/', validateLead, async (req, res, next) => {
  try {
    const { name, activity, city, email, phone } = req.body;
    const lead = Lead.create({ userId: req.userId, name, activity, city, email, phone });
    res.status(201).json({ success: true, data: lead });
  } catch (err) {
    next(err);
  }
});

router.get('/', async (req, res, next) => {
  try {
    const leads = Lead.findAllByUser(req.userId);
    res.json({ success: true, data: leads });
  } catch (err) {
    next(err);
  }
});

router.get('/:id', async (req, res, next) => {
  try {
    const lead = Lead.findById(req.params.id);
    if (!lead)               return next(Errors.notFound('Lead introuvable'));
    if (lead.user_id !== req.userId) return next(Errors.forbidden());
    res.json({ success: true, data: lead });
  } catch (err) {
    next(err);
  }
});

router.delete('/:id', async (req, res, next) => {
  try {
    const lead = Lead.findById(req.params.id);
    if (!lead)               return next(Errors.notFound('Lead introuvable'));
    if (lead.user_id !== req.userId) return next(Errors.forbidden());
    Lead.deleteById(req.params.id);
    res.json({ success: true, data: { deleted: true } });
  } catch (err) {
    next(err);
  }
});

export default router;
