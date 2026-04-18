import express from 'express';
import { getDb } from '../../db/database.js';
import { logger } from '../../utils/logger.js';

const router = express.Router();

router.get('/', async (req, res, next) => {
  try {
    const db     = getDb();
    const userId = req.userId;

    const totalLeads = db.prepare('SELECT COUNT(*) as n FROM leads WHERE user_id = ?').get(userId).n;
    const totalSites = db.prepare('SELECT COUNT(*) as n FROM sites WHERE user_id = ?').get(userId).n;
    const totalViews = db.prepare('SELECT COALESCE(SUM(views),0) as n FROM sites WHERE user_id = ?').get(userId).n;

    const leadsByStatus = db.prepare(
      'SELECT status, COUNT(*) as count FROM leads WHERE user_id = ? GROUP BY status'
    ).all(userId);
    const statusMap = Object.fromEntries(leadsByStatus.map(r => [r.status, r.count]));

    const leadsWithSite = db.prepare(
      'SELECT COUNT(DISTINCT lead_id) as n FROM sites WHERE user_id = ?'
    ).get(userId).n;

    const conversionRate = totalLeads > 0
      ? Math.round((leadsWithSite / totalLeads) * 10000) / 100
      : 0;

    const activeSites = db.prepare(
      "SELECT COUNT(*) as n FROM sites WHERE user_id = ? AND last_viewed >= datetime('now','-7 days')"
    ).get(userId).n;

    const topSites = db.prepare(`
      SELECT s.id, s.url, s.views, s.last_viewed, l.name as lead_name, l.city, l.email as lead_email
      FROM sites s JOIN leads l ON l.id = s.lead_id
      WHERE s.user_id = ? ORDER BY s.views DESC LIMIT 5
    `).all(userId);

    const recentActivity = db.prepare(`
      SELECT DATE(created_at) as day, COUNT(*) as leads_created
      FROM leads WHERE user_id = ? AND created_at >= datetime('now','-7 days')
      GROUP BY day ORDER BY day ASC
    `).all(userId);

    const unconvertedLeads = db.prepare(`
      SELECT l.id, l.name, l.city, l.status, l.email, l.created_at
      FROM leads l LEFT JOIN sites s ON s.lead_id = l.id
      WHERE l.user_id = ? AND s.id IS NULL AND l.status != 'error'
      ORDER BY l.created_at DESC LIMIT 10
    `).all(userId);

    res.json({
      success: true,
      data: {
        summary: {
          total_leads:      totalLeads,
          total_sites:      totalSites,
          total_views:      totalViews,
          active_sites:     activeSites,
          conversion_rate:  conversionRate,
          leads_pending:    statusMap['pending']    ?? 0,
          leads_processing: statusMap['processing'] ?? 0,
          leads_done:       statusMap['done']       ?? 0,
          leads_error:      statusMap['error']      ?? 0,
        },
        top_sites:        topSites,
        recent_activity:  recentActivity,
        unconverted_leads: unconvertedLeads,
      },
    });
  } catch (err) {
    logger.error('Analytics error', { error: err.message });
    next(err);
  }
});

export default router;
