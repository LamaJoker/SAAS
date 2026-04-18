import express from 'express';
import { Site }   from '../../db/models/Site.js';
import { User }   from '../../db/models/User.js';
import { Errors } from '../../utils/AppError.js';

const router = express.Router();

router.get('/', async (req, res, next) => {
  try {
    const sites = Site.findAllByUser(req.userId);
    res.json({ success: true, data: sites });
  } catch (err) {
    next(err);
  }
});

router.get('/credits', async (req, res, next) => {
  try {
    const user = User.findById(req.userId);
    if (!user) return next(Errors.unauthorized());
    res.json({ success: true, data: { credits: user.credits } });
  } catch (err) {
    next(err);
  }
});

router.get('/:id', async (req, res, next) => {
  try {
    const site = Site.findById(req.params.id);
    if (!site)                  return next(Errors.notFound('Site introuvable'));
    if (site.user_id !== req.userId) return next(Errors.forbidden());
    res.json({ success: true, data: site });
  } catch (err) {
    next(err);
  }
});

export default router;
