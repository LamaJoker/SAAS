/**
 * queries.js — Requêtes SQL applicatives (lectures/écritures hors modèles CRUD),
 * sorties des routes pour centraliser le SQL (étape 2 de la migration PG).
 *
 * Toutes les fonctions sont ASYNCHRONES (résolvent immédiatement en SQLite) :
 * le jour du passage à PostgreSQL, seul ce fichier + repo.js + les modèles
 * changent — les routes appellent déjà `await`.
 */
import { getDb } from './database.js';
import { randomBytes } from 'crypto';

// ── Dashboard business ──────────────────────────────────────────────────────
export async function dashboardMetrics(userId) {
  const db = getDb();

  const totalLeads = db.prepare('SELECT COUNT(*) as n FROM leads WHERE user_id = ?').get(userId).n;
  const totalSites = db.prepare('SELECT COUNT(*) as n FROM sites WHERE user_id = ?').get(userId).n;
  const totalViews = db.prepare('SELECT COALESCE(SUM(views), 0) as n FROM sites WHERE user_id = ?').get(userId).n;

  const leadsByStatus = db.prepare('SELECT status, COUNT(*) as count FROM leads WHERE user_id = ? GROUP BY status').all(userId);
  const statusMap = {};
  for (const row of leadsByStatus) statusMap[row.status] = row.count;

  const leadsWithSite = db.prepare('SELECT COUNT(DISTINCT lead_id) as n FROM sites WHERE user_id = ?').get(userId).n;
  const conversionRate = totalLeads > 0 ? Math.round((leadsWithSite / totalLeads) * 10000) / 100 : 0;

  const activeSites = db.prepare(
    "SELECT COUNT(*) as n FROM sites WHERE user_id = ? AND last_viewed >= datetime('now', '-7 days')"
  ).get(userId).n;

  const topSites = db.prepare(`
    SELECT s.id, s.slug, s.url, s.views, s.last_viewed, l.name as lead_name, l.city, l.email as lead_email
    FROM sites s JOIN leads l ON l.id = s.lead_id
    WHERE s.user_id = ? ORDER BY s.views DESC LIMIT 5
  `).all(userId);

  const recentActivity = db.prepare(`
    SELECT DATE(created_at) as day, COUNT(*) as leads_created
    FROM leads WHERE user_id = ? AND created_at >= datetime('now', '-7 days')
    GROUP BY day ORDER BY day ASC
  `).all(userId);

  const hotLeads = db.prepare(`
    SELECT e.id, e.meta, e.created_at, l.id as lead_id, l.name as lead_name, l.city, l.pipeline, s.slug, s.url
    FROM events e
    LEFT JOIN leads l ON l.id = e.lead_id
    LEFT JOIN sites s ON s.id = e.site_id
    WHERE e.type = 'contact_form' AND e.user_id = ?
    ORDER BY
      CASE WHEN l.pipeline = 'rappeler' THEN 0 ELSE 1 END,
      CASE WHEN l.pipeline = 'rappeler' THEN julianday(e.created_at) ELSE -julianday(e.created_at) END
    LIMIT 20
  `).all(userId).map(row => ({ ...row, meta: row.meta ? JSON.parse(row.meta) : null }));

  const emailByVariant = db.prepare(`
    SELECT ee.variant,
           SUM(ee.event_type = 'sent')  AS sent,
           SUM(ee.event_type = 'open')  AS opens,
           SUM(ee.event_type = 'click') AS clicks
    FROM email_events ee JOIN sites s ON s.id = ee.site_id
    WHERE s.user_id = ? AND ee.variant IS NOT NULL
    GROUP BY ee.variant ORDER BY sent DESC
  `).all(userId);

  const emailTotals = emailByVariant.reduce(
    (acc, v) => ({ sent: acc.sent + (v.sent || 0), opens: acc.opens + (v.opens || 0), clicks: acc.clicks + (v.clicks || 0) }),
    { sent: 0, opens: 0, clicks: 0 }
  );

  const sequenceStatus = db.prepare(`
    SELECT es.status, COUNT(*) AS count FROM email_sequence es
    JOIN sites s ON s.id = es.site_id WHERE s.user_id = ? GROUP BY es.status
  `).all(userId);
  const seqMap = {};
  for (const row of sequenceStatus) seqMap[row.status] = row.count;

  const unconvertedLeads = db.prepare(`
    SELECT l.id, l.name, l.city, l.status, l.email, l.created_at
    FROM leads l LEFT JOIN sites s ON s.lead_id = l.id
    WHERE l.user_id = ? AND s.id IS NULL AND l.status != 'error'
    ORDER BY l.created_at DESC LIMIT 10
  `).all(userId);

  return {
    summary: {
      total_leads: totalLeads, total_sites: totalSites, total_views: totalViews,
      active_sites: activeSites, conversion_rate: conversionRate,
      leads_pending: statusMap['pending'] ?? 0, leads_processing: statusMap['processing'] ?? 0,
      leads_done: statusMap['done'] ?? 0, leads_error: statusMap['error'] ?? 0,
    },
    top_sites: topSites, recent_activity: recentActivity, unconverted_leads: unconvertedLeads,
    hot_leads: hotLeads,
    email_stats: {
      totals: {
        ...emailTotals,
        open_rate:  emailTotals.sent > 0 ? Math.round((emailTotals.opens  / emailTotals.sent) * 1000) / 10 : 0,
        click_rate: emailTotals.sent > 0 ? Math.round((emailTotals.clicks / emailTotals.sent) * 1000) / 10 : 0,
      },
      by_variant: emailByVariant.map(v => ({
        ...v,
        open_rate:  v.sent > 0 ? Math.round((v.opens  / v.sent) * 1000) / 10 : 0,
        click_rate: v.sent > 0 ? Math.round((v.clicks / v.sent) * 1000) / 10 : 0,
      })),
      sequence: { pending: seqMap['pending'] ?? 0, done: seqMap['done'] ?? 0, unsubscribed: seqMap['unsubscribed'] ?? 0 },
    },
  };
}

// ── Analytics globales ──────────────────────────────────────────────────────
export async function analyticsOverview(userId) {
  const db = getDb();
  const totalLeads = db.prepare('SELECT COUNT(*) as n FROM leads WHERE user_id = ?').get(userId).n;
  const totalSites = db.prepare('SELECT COUNT(*) as n FROM sites WHERE user_id = ?').get(userId).n;
  const totalViews = db.prepare('SELECT COALESCE(SUM(views),0) as n FROM sites WHERE user_id = ?').get(userId).n;

  const leadsByStatus = db.prepare('SELECT status, COUNT(*) as count FROM leads WHERE user_id = ? GROUP BY status').all(userId);
  const statusMap = Object.fromEntries(leadsByStatus.map(r => [r.status, r.count]));

  const leadsWithSite = db.prepare('SELECT COUNT(DISTINCT lead_id) as n FROM sites WHERE user_id = ?').get(userId).n;
  const conversionRate = totalLeads > 0 ? Math.round((leadsWithSite / totalLeads) * 10000) / 100 : 0;

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

  return {
    summary: {
      total_leads: totalLeads, total_sites: totalSites, total_views: totalViews,
      active_sites: activeSites, conversion_rate: conversionRate,
      leads_pending: statusMap['pending'] ?? 0, leads_processing: statusMap['processing'] ?? 0,
      leads_done: statusMap['done'] ?? 0, leads_error: statusMap['error'] ?? 0,
    },
    top_sites: topSites, recent_activity: recentActivity, unconverted_leads: unconvertedLeads,
  };
}

// ── Timeline d'un prospect ──────────────────────────────────────────────────
export async function leadTimeline(leadId) {
  const db = getDb();
  const events = db.prepare(
    'SELECT type, meta, created_at FROM events WHERE lead_id = ? ORDER BY created_at DESC LIMIT 50'
  ).all(leadId).map(e => ({ at: e.created_at, kind: e.type, meta: e.meta ? JSON.parse(e.meta) : null }));

  const sends = db.prepare(
    'SELECT variant_id, is_followup, created_at FROM email_sends WHERE lead_id = ? ORDER BY created_at DESC LIMIT 20'
  ).all(leadId).map(s => ({ at: s.created_at, kind: s.is_followup ? 'email_relance' : 'email_envoye', meta: { variant: s.variant_id } }));

  const opens = db.prepare(
    "SELECT event_type, variant, created_at FROM email_events WHERE lead_id = ? AND event_type IN ('open','click') ORDER BY created_at DESC LIMIT 50"
  ).all(leadId).map(e => ({ at: e.created_at, kind: e.event_type === 'open' ? 'email_ouvert' : 'lien_clique', meta: { variant: e.variant } }));

  return [...events, ...sends, ...opens].sort((a, b) => b.at.localeCompare(a.at)).slice(0, 100);
}

// ── Export RGPD : tables liées au compte ────────────────────────────────────
export async function exportUserRelated(userId) {
  const db = getDb();
  const leads   = db.prepare('SELECT * FROM leads WHERE user_id = ?').all(userId);
  const leadIds = leads.map(l => l.id);
  const inClause = leadIds.length ? `(${leadIds.map(() => '?').join(',')})` : '(NULL)';
  return {
    leads,
    sites:    db.prepare('SELECT * FROM sites  WHERE user_id = ?').all(userId),
    events:   db.prepare('SELECT * FROM events WHERE user_id = ?').all(userId),
    invoices: db.prepare('SELECT * FROM invoices WHERE user_id = ?').all(userId),
    email_sequence: leadIds.length ? db.prepare(`SELECT * FROM email_sequence WHERE lead_id IN ${inClause}`).all(...leadIds) : [],
    email_sends:    leadIds.length ? db.prepare(`SELECT * FROM email_sends    WHERE lead_id IN ${inClause}`).all(...leadIds) : [],
    email_events:   leadIds.length ? db.prepare(`SELECT * FROM email_events   WHERE lead_id IN ${inClause}`).all(...leadIds) : [],
  };
}

// ── Formulaire de contact : stoppe la séquence + pipeline rappeler ──────────
export async function markContactFollowup(leadId) {
  const db = getDb();
  db.prepare("UPDATE email_sequence SET status = 'done' WHERE lead_id = ? AND status = 'pending'").run(leadId);
  db.prepare("UPDATE leads SET pipeline = 'rappeler' WHERE id = ? AND pipeline IN ('nouveau','contacte','interesse')").run(leadId);
}

// ── Désabonnement ───────────────────────────────────────────────────────────
export async function unsubscribeEmail(email) {
  const db = getDb();
  db.prepare("INSERT OR IGNORE INTO email_blacklist (email, reason) VALUES (?, 'unsubscribe')").run(email);
  db.prepare("UPDATE email_sequence SET status = 'unsubscribed' WHERE lead_id IN (SELECT id FROM leads WHERE email = ?)").run(email);
}

// ── Tracking email (pixel ouverture + clic + stats) ─────────────────────────
export async function openSentParent(token) {
  return getDb().prepare("SELECT site_id, lead_id, variant, created_at FROM email_events WHERE token = ? AND event_type = 'sent' LIMIT 1").get(token);
}
export async function recentOpenExists(token, ip) {
  return !!getDb().prepare(
    "SELECT id FROM email_events WHERE token = ? AND event_type = 'open' AND ip = ? AND created_at >= datetime('now', '-5 minutes') LIMIT 1"
  ).get(token, ip);
}
export async function insertOpenEvent({ token, parent, ip, ua, machine }) {
  getDb().prepare(`
    INSERT INTO email_events (id, token, site_id, lead_id, variant, event_type, ip, user_agent, is_machine)
    VALUES (?,?,?,?,?,'open',?,?,?)
  `).run(randomBytes(8).toString('hex'), `${token}_open_${Date.now()}`, parent.site_id, parent.lead_id, parent.variant, ip, ua, machine ? 1 : 0);
}
export async function clickRegistered(clickToken) {
  return getDb().prepare(
    "SELECT site_id, lead_id, variant, url FROM email_events WHERE token = ? AND event_type = 'click_registered' LIMIT 1"
  ).get(clickToken);
}
export async function insertClickEvent({ clickToken, reg, ip, ua }) {
  getDb().prepare(`
    INSERT INTO email_events (id, token, site_id, lead_id, variant, event_type, url, ip, user_agent)
    VALUES (?,?,?,?,?,'click',?,?,?)
  `).run(randomBytes(8).toString('hex'), `${clickToken}_click_${Date.now()}`, reg.site_id, reg.lead_id, reg.variant, reg.url, ip, ua);
}
// ── Auth (révocation de tokens) ─────────────────────────────────────────────
export async function isTokenRevoked(jti) {
  return !!getDb().prepare('SELECT 1 FROM revoked_tokens WHERE jti = ?').get(jti);
}
export async function revokeJti(jti, expiresAt) {
  const db = getDb();
  db.prepare('INSERT OR IGNORE INTO revoked_tokens (jti, expires_at) VALUES (?, ?)').run(jti, expiresAt);
  db.prepare("DELETE FROM revoked_tokens WHERE expires_at < datetime('now')").run();
}

// ── Rappel SLA des prospects chauds ─────────────────────────────────────────
export async function staleHotLeads() {
  return getDb().prepare(`
    SELECT e.user_id, e.created_at, e.meta, l.id AS lead_id, l.name AS lead_name, l.phone
    FROM events e JOIN leads l ON l.id = e.lead_id
    WHERE e.type = 'contact_form'
      AND e.created_at <= datetime('now', '-1 hour')
      AND e.created_at >= datetime('now', '-24 hours')
      AND l.pipeline = 'rappeler'
      AND NOT EXISTS (SELECT 1 FROM events r WHERE r.type = 'hot_lead_reminder' AND r.lead_id = l.id)
  `).all();
}
export async function markHotLeadReminded(leadId, userId) {
  getDb().prepare("INSERT INTO events (id, type, lead_id, user_id, meta) VALUES (?, 'hot_lead_reminder', ?, ?, NULL)")
    .run(randomBytes(8).toString('hex'), leadId, userId);
}

// ── Réponses entrantes ──────────────────────────────────────────────────────
export async function findLeadsByEmail(email) {
  return getDb().prepare('SELECT * FROM leads WHERE lower(email) = ?').all(email);
}
export async function recordInboundReply(leadId, userId, subject, snippet) {
  const db = getDb();
  db.prepare("UPDATE email_sequence SET status = 'done' WHERE lead_id = ? AND status = 'pending'").run(leadId);
  db.prepare("UPDATE leads SET pipeline = 'rappeler' WHERE id = ? AND pipeline IN ('nouveau','contacte','interesse')").run(leadId);
  db.prepare("INSERT INTO events (id, type, lead_id, user_id, meta) VALUES (?, 'email_reply', ?, ?, ?)")
    .run(randomBytes(8).toString('hex'), leadId, userId, JSON.stringify({ subject, snippet }));
}

// ── Emailing : cadence + traçage des envois ─────────────────────────────────
export async function countEmailsForSite(siteId) {
  return getDb().prepare('SELECT COUNT(*) as n FROM email_sends WHERE site_id = ?').get(siteId)?.n ?? 0;
}
export async function lastEmailDaysAgo(siteId) {
  const row = getDb().prepare('SELECT created_at FROM email_sends WHERE site_id = ? ORDER BY created_at DESC LIMIT 1').get(siteId);
  if (!row) return Infinity;
  return (Date.now() - new Date(row.created_at).getTime()) / 86_400_000;
}
export async function isEmailBlacklisted(email) {
  return !!getDb().prepare('SELECT 1 FROM email_blacklist WHERE email = ?').get(email.toLowerCase());
}
export async function recordEmailSent({ siteId, leadId, variantId, messageId, isFollowup = false }) {
  getDb().prepare('INSERT INTO email_sends (id, site_id, lead_id, variant_id, message_id, is_followup) VALUES (?,?,?,?,?,?)')
    .run(randomBytes(8).toString('hex'), siteId, leadId, variantId, messageId, isFollowup ? 1 : 0);
}
export async function sitesForEmailQueue(userId, limit) {
  return getDb().prepare(`
    SELECT s.*, l.name as lead_name, l.city, l.email as lead_email, l.phone as lead_phone, l.id as lead_db_id
    FROM sites s JOIN leads l ON l.id = s.lead_id
    WHERE s.user_id = ? AND l.email IS NOT NULL
    ORDER BY s.created_at DESC LIMIT ?
  `).all(userId, limit);
}

export async function emailStats(userId, days) {
  const db = getDb();
  const summary = db.prepare(`
    SELECT SUM(ee.event_type = 'sent')  as sent,
           SUM(ee.event_type = 'open')  as opens,
           SUM(ee.event_type = 'open' AND ee.is_machine = 0) as human_opens,
           SUM(ee.event_type = 'click') as clicks
    FROM email_events ee JOIN sites s ON s.id = ee.site_id
    WHERE s.user_id = ? AND ee.created_at >= datetime('now', '-' || ? || ' days')
  `).get(userId, days);
  const byVariant = db.prepare(`
    SELECT ee.variant,
           SUM(ee.event_type = 'sent')  as sent,
           SUM(ee.event_type = 'open')  as opens,
           SUM(ee.event_type = 'click') as clicks
    FROM email_events ee JOIN sites s ON s.id = ee.site_id
    WHERE s.user_id = ? AND ee.created_at >= datetime('now', '-' || ? || ' days') AND ee.variant IS NOT NULL
    GROUP BY ee.variant ORDER BY opens DESC
  `).all(userId, days);
  return { summary, byVariant };
}
