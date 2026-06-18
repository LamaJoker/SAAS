/**
 * sequenceService.js — Séquence email automatique + scoring leads
 *
 * Séquence :
 *   J0 → premier contact (variante A/B)
 *   J+3 → relance si pas d'ouverture
 *   J+7 → dernier message si pas de clic
 *
 * La table email_sequence est créée par la migration v6 (database.js).
 * Usage : appelé par un cron ou un worker périodique.
 */

import { getDb }            from '../db/database.js';
import { smtpPool }         from './smtpPool.js';
import { createTrackingPixel, wrapLink } from './trackingService.js';
import { repo }             from '../db/repo.js';
import { logger }           from '../utils/logger.js';
import { randomBytes }      from 'crypto';
import { config }           from '../config/config.js';
import { buildUnsubToken }  from '../utils/unsubToken.js';
import { FOLLOWUP_IDS, VARIANT_IDS } from '../email/index.js';
import { renderEmail }      from '../email/render.js';
import { sendWhatsAppDemo, sendWhatsAppFollowup } from './whatsappService.js';

// ─── Warmup (montée en charge progressive de l'envoi email) ─────────────────────
// Pur, testable : plafond quotidien = start + (jours écoulés × step), borné à max.
export function computeWarmupCap({ enabled, startPerDay, incrementPerDay, maxPerDay }, daysElapsed) {
  if (!enabled) return Infinity;
  return Math.min(maxPerDay, startPerDay + Math.max(0, daysElapsed) * incrementPerDay);
}

function dailyEmailCap() {
  const w = config.features.warmup;
  if (!w.enabled) return Infinity;
  const startRow = w.startedAt
    ? new Date(w.startedAt)
    : new Date(getDb().prepare('SELECT MIN(created_at) AS d FROM email_sends').get()?.d ?? Date.now());
  const daysElapsed = Math.floor((Date.now() - startRow.getTime()) / 86_400_000);
  return computeWarmupCap(w, daysElapsed);
}

function sentTodayCount() {
  return getDb().prepare("SELECT COUNT(*) AS n FROM email_sends WHERE date(created_at) = date('now')").get().n;
}

// ─── Lead scoring ─────────────────────────────────────────────────────────────
const HIGH_VALUE_ACTIVITIES = [
  'plombier', 'électricien', 'couvreur', 'maçon', 'dentiste',
  'médecin', 'avocat', 'notaire', 'garagiste', 'chauffagiste',
  'expert-comptable', 'architecte', 'kinésithérapeute',
];

export function scoreLead(lead, site) {
  let score = 0;
  const ageDays = (Date.now() - new Date(lead.created_at).getTime()) / 86_400_000;
  const activity = (lead.activity || '').toLowerCase();

  if (ageDays < 1)   score += 30;
  else if (ageDays < 3) score += 15;
  else if (ageDays < 7) score += 5;

  if (lead.phone)  score += 20;
  if (lead.email && lead.email.includes('@'))  score += 5;

  if (HIGH_VALUE_ACTIVITIES.some(a => activity.includes(a))) score += 15;
  if ((lead.rating || 0) >= 4.5)  score += 10;
  if (!lead.website || lead.website === '') score += 10;

  if (site?.views > 0) score -= 5; // déjà vu = moins urgent

  return Math.min(100, Math.max(0, score));
}

// ─── Plan de séquence ─────────────────────────────────────────────────────────
// Étape 0 : variante A/B tirée au sort parmi src/email/variants/ (5 angles).
// Étapes 1-2 : relances fixes depuis src/email/followup/.
// `delay` = jours d'attente APRÈS l'envoi précédent (J0 → J+3 → J+7).
const SEQUENCE_PLAN = [
  { step: 0, delay: 0, pickRandom: true },
  { step: 1, delay: 3, variantId: 'relance_soft' },
  { step: 2, delay: 4, variantId: 'relance_directe' },
];

function pickStepVariantId(planEntry) {
  if (planEntry.pickRandom) {
    return VARIANT_IDS[Math.floor(Math.random() * VARIANT_IDS.length)];
  }
  return FOLLOWUP_IDS.includes(planEntry.variantId) ? planEntry.variantId : null;
}

// ─── Filtre adresses personnelles ─────────────────────────────────────────────
// En France (L.34-5 CPCE / doctrine CNIL), la prospection B2B sans consentement
// n'est défendable que vers des adresses à caractère professionnel.
// COLD_EMAIL_PERSONAL=allow pour désactiver le filtre (à vos risques).
// Webmails purs uniquement : les domaines FAI (orange.fr, free.fr, sfr.fr…)
// sont volontairement absents — très répandus comme adresses pro d'artisans.
const PERSONAL_DOMAINS = new Set([
  'gmail.com', 'googlemail.com', 'hotmail.com', 'hotmail.fr', 'outlook.com',
  'outlook.fr', 'live.com', 'live.fr', 'msn.com', 'yahoo.com', 'yahoo.fr',
  'icloud.com', 'me.com', 'aol.com', 'protonmail.com', 'proton.me', 'gmx.fr',
  'gmx.com', 'laposte.net',
]);

export function isPersonalEmail(email) {
  if (typeof email !== 'string') return false;
  const domain = email.split('@')[1]?.toLowerCase().trim();
  return !!domain && PERSONAL_DOMAINS.has(domain);
}

function personalEmailsBlocked() {
  return (process.env.COLD_EMAIL_PERSONAL || 'block') !== 'allow';
}

function isBlacklisted(email) {
  return !!getDb().prepare('SELECT 1 FROM email_blacklist WHERE email = ?')
    .get(email.toLowerCase());
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Choisit le canal d'outreach d'un lead :
 *   - 'email'    si une adresse est disponible (canal principal)
 *   - 'whatsapp' si pas d'email mais un téléphone ET WhatsApp activé
 *   - null       sinon (lead injoignable automatiquement → pas d'enrôlement)
 */
export function pickChannel(lead) {
  if (lead.email) return 'email';
  if (config.features.whatsapp.enabled && lead.phone) return 'whatsapp';
  return null;
}

/**
 * Enregistre un site dans la séquence d'outreach.
 * Appelé après chaque génération réussie. Retourne le canal retenu (ou null).
 */
export function enrollSite(siteId, leadId, score = 0, channel = 'email') {
  if (!channel) return null;
  const db = getDb();
  const id = randomBytes(8).toString('hex');

  db.prepare(`
    INSERT OR IGNORE INTO email_sequence (id, site_id, lead_id, step, status, next_send_at, score, channel)
    VALUES (?, ?, ?, 0, 'pending', datetime('now'), ?, ?)
  `).run(id, siteId, leadId, score, channel);
  return channel;
}

/**
 * Traite tous les emails en attente d'envoi.
 * À appeler régulièrement (toutes les 30 min via cron ou worker).
 */
function done(db, id) {
  db.prepare("UPDATE email_sequence SET status = 'done' WHERE id = ?").run(id);
}

function advance(db, entry) {
  const nextStep     = entry.step + 1;
  const nextPlan     = SEQUENCE_PLAN[nextStep];
  const hasMoreSteps = !!nextPlan;
  db.prepare(`
    UPDATE email_sequence
    SET step = ?, status = ?, last_sent_at = datetime('now'),
        next_send_at = CASE WHEN ? THEN datetime('now', '+' || ? || ' days') ELSE NULL END
    WHERE id = ?
  `).run(nextStep, hasMoreSteps ? 'pending' : 'done', hasMoreSteps ? 1 : 0, nextPlan?.delay ?? 0, entry.id);
}

// Le prospect a-t-il déjà cliqué (email) → fin de séquence anticipée
function hasClicked(db, leadId) {
  return !!db.prepare("SELECT id FROM email_events WHERE lead_id = ? AND event_type = 'click' LIMIT 1").get(leadId);
}

async function sendEmailStep(db, entry, site, lead, senderName) {
  if (!lead.email || isBlacklisted(lead.email)) { done(db, entry.id); return 'skipped'; }
  if (personalEmailsBlocked() && isPersonalEmail(lead.email)) {
    done(db, entry.id);
    logger.info(`[Sequence] Adresse personnelle ignorée: ${lead.email}`);
    return 'skipped';
  }
  if (entry.step > 0 && hasClicked(db, lead.id)) { done(db, entry.id); return 'skipped'; }

  const planEntry = SEQUENCE_PLAN[entry.step];
  const variantId = planEntry ? pickStepVariantId(planEntry) : null;
  if (!variantId) { done(db, entry.id); return 'skipped'; }

  const { token, pixelUrl } = createTrackingPixel({ siteId: site.id, leadId: lead.id, variant: variantId });
  const trackedUrl = wrapLink({ url: site.url, token, label: 'cta' });
  const { subject, text, html } = renderEmail(variantId, {
    name: lead.name, city: lead.city, url: site.url, sender: senderName,
    pixelUrl, trackedUrl, toEmail: lead.email,
  });

  const sendResult = await smtpPool.send({
    to: lead.email, subject, text, html,
    headers: {
      'X-Variant':        variantId,
      'Precedence':       'bulk',
      'List-Unsubscribe': `<${config.server.baseUrl}/unsubscribe/${buildUnsubToken(lead.email)}>`,
    },
  });

  db.prepare('INSERT INTO email_sends (id, site_id, lead_id, variant_id, message_id, is_followup) VALUES (?,?,?,?,?,?)')
    .run(randomBytes(8).toString('hex'), site.id, lead.id, variantId, sendResult.messageId ?? '', entry.step > 0 ? 1 : 0);

  advance(db, entry);
  logger.info(`[Sequence] Email step ${entry.step}: ${lead.email} | variant=${variantId}`);
  return 'sent';
}

async function sendWhatsappStep(db, entry, site, lead, senderName) {
  if (!config.features.whatsapp.enabled || !lead.phone) { done(db, entry.id); return 'skipped'; }

  const fn = entry.step === 0 ? sendWhatsAppDemo : sendWhatsAppFollowup;
  const res = await fn({ phone: lead.phone, name: lead.name, url: site.url, senderName });
  if (res.skipped) {
    // Twilio non configuré / numéro invalide → on clôt pour ne pas boucler
    done(db, entry.id);
    logger.info(`[Sequence] WhatsApp ignoré (${res.error})`, { leadId: lead.id });
    return 'skipped';
  }
  advance(db, entry);
  logger.info(`[Sequence] WhatsApp step ${entry.step}: ${lead.phone} | sid=${res.sid}`);
  return 'sent';
}

/**
 * Traite tous les messages d'outreach dus (email + WhatsApp).
 * Appelé toutes les 30 min par le sequenceWorker. Respecte le warmup email.
 */
export async function processSequence() {
  const db = getDb();
  const emailReady = smtpPool.isConfigured;
  const waReady    = config.features.whatsapp.enabled;

  if (!emailReady && !waReady) {
    logger.warn('[Sequence] Aucun canal configuré (SMTP/WhatsApp) — traitement ignoré');
    return { sent: 0, errors: 0, skipped: 0 };
  }

  const due = db.prepare(`
    SELECT * FROM email_sequence
    WHERE status = 'pending' AND next_send_at <= datetime('now')
    ORDER BY score DESC, next_send_at ASC
    LIMIT 50
  `).all();

  if (!due.length) { logger.debug('[Sequence] Rien à envoyer'); return { sent: 0, errors: 0, skipped: 0 }; }

  // Budget warmup : nombre d'emails encore autorisés aujourd'hui (Infinity si off)
  let emailBudget = dailyEmailCap() - sentTodayCount();

  const stats = { sent: 0, errors: 0, skipped: 0 };
  const senderName = process.env.SMTP_SENDER_NAME || 'AutoDemo';

  for (const entry of due) {
    try {
      const site = await repo.sites.findById(entry.site_id);
      const lead = await repo.leads.findById(entry.lead_id);
      if (!site || !lead) { done(db, entry.id); stats.skipped++; continue; }

      const channel = entry.channel || 'email';

      if (channel === 'whatsapp') {
        if (!waReady) { stats.skipped++; continue; } // réessayé au prochain tick
        const r = await sendWhatsappStep(db, entry, site, lead, senderName);
        r === 'sent' ? stats.sent++ : stats.skipped++;
      } else {
        if (!emailReady) { stats.skipped++; continue; }
        if (emailBudget <= 0) {
          // Plafond warmup atteint : on repousse à demain, on ne clôt pas
          db.prepare("UPDATE email_sequence SET next_send_at = datetime('now','+1 day') WHERE id = ?").run(entry.id);
          stats.skipped++;
          continue;
        }
        const r = await sendEmailStep(db, entry, site, lead, senderName);
        if (r === 'sent') { stats.sent++; emailBudget--; } else stats.skipped++;
      }

      await new Promise(r => setTimeout(r, 2000 + Math.random() * 1000));
    } catch (err) {
      logger.error(`[Sequence] Erreur entrée ${entry.id}: ${err.message}`);
      stats.errors++;
    }
  }

  return stats;
}

/**
 * Désabonnement d'un lead.
 */
export function unsubscribe(leadId) {
  getDb().prepare(
    "UPDATE email_sequence SET status = 'unsubscribed' WHERE lead_id = ?"
  ).run(leadId);
}
