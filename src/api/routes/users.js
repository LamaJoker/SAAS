import express from 'express';
import { User }          from '../../db/models/User.js';
import { generateToken } from '../middleware/auth.js';
import { Errors }        from '../../utils/AppError.js';
import { sanitizeInput } from '../../utils/utils.js';

const router = express.Router();

router.post('/register', async (req, res, next) => {
  try {
    const email = sanitizeInput(req.body.email ?? '', 200).toLowerCase();
    const name  = sanitizeInput(req.body.name  ?? '', 200);

    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
      return next(Errors.badRequest('Email invalide'));
    }

    const existing = User.findByEmail(email);
    if (existing) {
      return next(Errors.conflict('Un compte existe déjà avec cet email'));
    }

    const user  = User.create({ email, name: name || email.split('@')[0] });
    const token = generateToken(user.id);

    res.status(201).json({
      success: true,
      data: {
        token,
        user: { id: user.id, email: user.email, name: user.name, credits: user.credits },
      },
    });
  } catch (err) {
    next(err);
  }
});

router.post('/login', async (req, res, next) => {
  try {
    const email = sanitizeInput(req.body.email ?? '', 200).toLowerCase();

    if (!email) return next(Errors.badRequest('Email requis'));

    let user = User.findByEmail(email);
    if (!user) {
      user = User.create({ email, name: email.split('@')[0] });
    }

    const token = generateToken(user.id);

    res.json({
      success: true,
      data: {
        token,
        user: { id: user.id, email: user.email, name: user.name, credits: user.credits },
      },
    });
  } catch (err) {
    next(err);
  }
});

export default router;
