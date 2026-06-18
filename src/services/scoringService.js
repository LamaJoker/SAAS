import { getDb } from '../db/database.js';

/**
 * Calcule un score d'engagement 0-100 pour un site donné.
 *
 * Dimensions mesurées :
 *  - Volume de vues
 *  - Fraîcheur de la dernière visite
 *  - Corrélation email envoyé → visite (signe d'intérêt fort)
 *  - Visite sur plusieurs jours distincts (signe d'hésitation positive)
 *  - Contact form soumis (conversion directe)
 *
 * Utilisation : trier la file d'envoi email par score desc
 * pour maximiser les conversions à budget envoi constant.
 *
 * @param {object} site    - Ligne de la table `sites`
 * @param {object[]} events - Lignes de la table `events` pour ce site
 * @returns {number} Score 0-100
 */
export function computeEngagementScore(site, events = []) {
  let score = 0;

  const views = site.views ?? 0;
  const emailEvents = events.filter(e => e.type === 'email_sent');
  const viewEvents  = events.filter(e => e.type === 'demo_view');
  const contactEvents = events.filter(e => e.type === 'contact_form');

  // ── Contact form soumis = conversion directe ────────────────────────────────
  if (contactEvents.length > 0) return 100; // Score max — à appeler immédiatement

  // ── Volume de vues ──────────────────────────────────────────────────────────
  if (views >= 1) score += 15;
  if (views >= 3) score += 10;
  if (views >= 7) score += 8;
  if (views >= 15) score += 5;

  // ── Fraîcheur de la dernière visite ────────────────────────────────────────
  if (site.last_viewed) {
    const daysSince = (Date.now() - new Date(site.last_viewed).getTime()) / 86_400_000;
    if (daysSince < 1)  score += 25;
    else if (daysSince < 3)  score += 18;
    else if (daysSince < 7)  score += 10;
    else if (daysSince < 14) score += 4;
  }

  // ── Visite après réception d'un email (corrélation forte) ──────────────────
  if (emailEvents.length > 0 && viewEvents.length > 0) {
    const lastEmailDate = new Date(
      emailEvents.sort((a, b) => new Date(b.created_at) - new Date(a.created_at))[0].created_at
    );
    const viewedAfterEmail = viewEvents.some(e => new Date(e.created_at) > lastEmailDate);
    if (viewedAfterEmail) score += 20; // A cliqué le lien de la démo
  }

  // ── Visites sur plusieurs jours distincts ──────────────────────────────────
  const visitDays = new Set(viewEvents.map(e => e.created_at?.slice(0, 10)));
  if (visitDays.size >= 2) score += 10; // Revenu consulter plusieurs fois
  if (visitDays.size >= 4) score += 5;

  // ── Pénalité : trop d'emails sans réponse ──────────────────────────────────
  if (emailEvents.length >= 3 && views === 0) score -= 20; // Probablement pas intéressé
  if (emailEvents.length >= 2 && views === 0) score -= 10;

  return Math.max(0, Math.min(100, Math.round(score)));
}

/**
 * Récupère les sites avec leur score d'engagement pour un utilisateur.
 * Trié par score décroissant — utilisé pour prioriser la file email.
 *
 * @param {string} userId
 * @param {{ minScore?: number, limit?: number }} options
 * @returns {Array<{ site, events, score }>}
 */
export function getScoredSitesForUser(userId, { minScore = 0, limit = 100 } = {}) {
  const db = getDb();

  const sites = db.prepare(`
    SELECT s.*, l.name AS lead_name, l.city, l.email AS lead_email,
           l.phone AS lead_phone
    FROM sites s
    JOIN leads l ON l.id = s.lead_id
    WHERE s.user_id = ?
    ORDER BY s.last_viewed DESC NULLS LAST
    LIMIT ?
  `).all(userId, limit * 2); // Récupère plus pour filtrer par score ensuite

  const scored = sites.map(site => {
    const events = db.prepare(`
      SELECT type, created_at FROM events
      WHERE site_id = ?
      ORDER BY created_at ASC
    `).all(site.id);

    const score = computeEngagementScore(site, events);
    return { site, events, score };
  });

  return scored
    .filter(({ score }) => score >= minScore)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

/**
 * Récupère les leads "chauds" qui méritent une relance urgente.
 * Critères : score >= 60 ET pas d'email dans les 12 dernières heures.
 *
 * @param {string} userId
 * @returns {Array<{ site, score }>}
 */
export function getHotLeadsToContact(userId) {
  const db = getDb();

  const candidates = db.prepare(`
    SELECT s.*, l.name AS lead_name, l.city, l.email AS lead_email, l.phone AS lead_phone
    FROM sites s
    JOIN leads l ON l.id = s.lead_id
    WHERE s.user_id = ?
      AND l.email IS NOT NULL
      AND s.last_viewed >= datetime('now', '-24 hours')
      AND NOT EXISTS (
        SELECT 1 FROM events e
        WHERE e.site_id = s.id
          AND e.type = 'email_sent'
          AND e.created_at >= datetime('now', '-12 hours')
      )
    ORDER BY s.last_viewed DESC
    LIMIT 50
  `).all(userId);

  return candidates
    .map(site => {
      const events = db.prepare(
        'SELECT type, created_at FROM events WHERE site_id = ? ORDER BY created_at ASC'
      ).all(site.id);
      return { site, score: computeEngagementScore(site, events) };
    })
    .filter(({ score }) => score >= 60)
    .sort((a, b) => b.score - a.score);
}

/**
 * Détermine le label lisible du score pour affichage dashboard.
 * @param {number} score
 * @returns {{ label: string, color: string }}
 */
export function scoreLabel(score) {
  if (score >= 80) return { label: 'Très chaud 🔥', color: 'red' };
  if (score >= 60) return { label: 'Intéressé 👀',  color: 'amber' };
  if (score >= 30) return { label: 'Tiède',          color: 'blue' };
  return              { label: 'Froid',              color: 'gray' };
}
