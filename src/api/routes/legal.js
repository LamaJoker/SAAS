/**
 * routes/legal.js — Pages légales publiques (mentions, confidentialité, CGV).
 */
import express from 'express';
import { renderIndex, renderMentions, renderPrivacy, renderCGV } from '../../services/legalService.js';

const router = express.Router();

function html(res, content) {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=3600');
  res.send(content);
}

router.get('/',                (req, res) => html(res, renderIndex()));
router.get('/mentions',        (req, res) => html(res, renderMentions()));
router.get('/confidentialite', (req, res) => html(res, renderPrivacy()));
router.get('/cgv',             (req, res) => html(res, renderCGV()));

export default router;
