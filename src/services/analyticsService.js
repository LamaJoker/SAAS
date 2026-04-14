import { Event, EVENT_TYPES } from '../db/models/Event.js';
import { getDb } from '../db/database.js';

export function trackEvent(type, opts = {}) {
  return Event.track({ type, ...opts });
}

export function getAnalytics() {
  const db = getDb();
  const totalLeads = db.prepare('SELECT COUNT(*) as n FROM leads').get().n;
  const totalSites = db.prepare('SELECT COUNT(*) as n FROM sites').get().n;
  const totalUsers = db.prepare('SELECT COUNT(*) as n FROM users').get().n;
  const emailsSent = Event.countByType(EVENT_TYPES.EMAIL_SENT);
  const demoViews  = Event.countByType(EVENT_TYPES.DEMO_VIEW);
  const ctaClicks  = Event.countByType(EVENT_TYPES.CLICK_CTA);

  const leadsWithClick = db.prepare(`
    SELECT COUNT(DISTINCT lead_id) as n
    FROM events
    WHERE type = ? AND lead_id IS NOT NULL
  `).get(EVENT_TYPES.CLICK_CTA).n;

  const conversionRate = emailsSent > 0
    ? Math.round((leadsWithClick / emailsSent) * 10000) / 100
    : 0;

  const topSites = db.prepare(`
    SELECT s.slug, s.url, l.name AS lead_name, l.city,
           COUNT(e.id) AS view_count
    FROM events e
    JOIN sites s ON s.id = e.site_id
    JOIN leads l ON l.id = s.lead_id
    WHERE e.type = ?
    GROUP BY e.site_id
    ORDER BY view_count DESC
    LIMIT 5
  `).all(EVENT_TYPES.DEMO_VIEW);

  const dailyActivity = db.prepare(`
    SELECT DATE(created_at) as day, type, COUNT(*) as count
    FROM events
    WHERE created_at >= datetime('now', '-7 days')
    GROUP BY day, type
    ORDER BY day DESC
  `).all();

  return {
    summary: {
      total_users:      totalUsers,
      total_leads:      totalLeads,
      total_sites:      totalSites,
      emails_sent:      emailsSent,
      demo_views:       demoViews,
      cta_clicks:       ctaClicks,
      conversion_rate:  conversionRate,
    },
    top_sites:      topSites,
    daily_activity: dailyActivity,
  };
}