import express from 'express';
import { listTemplates } from '../../services/templateService.js';

const router = express.Router();

router.get('/', (req, res) => {
  res.json({ success: true, data: listTemplates() });
});

export default router;
