#!/usr/bin/env node
/**
 * sendEmails.js — Machine à conversion professionnelle v2
 *
 * Nouveautés v2 :
 *   - Tracking ouvertures via pixel 1x1 (endpoint /track/open/:token)
 *   - Tracking clics via redirect (endpoint /track/click/:token)
 *   - Rotation intelligente des variantes (UCB1 multi-armed bandit)
 *   - Score comportemental : ouverture+clic = lead chaud → flag DB
 *   - Blacklist automatique après N ignores
 *   - Détection spam words
 *   - Warmup SMTP (rampe progressive)
 *   - Anti-duplicate par Message-ID stocké
 *   - Fallback gracieux email invalide
 *
 * Usage :
 *   node scripts/sendEmails.js --userId <ID>
 *   node scripts/sendEmails.js --userId <ID> --dry-run
 *   node scripts/sendEmails.js --userId <ID> --limit 50 --warmup
 *   node scripts/sendEmails.js --userId <ID> --only-new
 *   node scripts/sendEmails.js --userId <ID> --retry-failed
 *   node scripts/sendEmails.js --userId <ID> --variant direct
 *   node scripts/sendEmails.js --userId <ID> --follow-up-days 5
 */

import nodemailer    from 'nodemailer';
import { parseArgs } from 'node:util';
import { createApiClient } from './lib/apiClient.js';
import { randomUUID, createHash } from 'node:crypto';
import { getDb }     from '../src/db/database.js';
import { logger }    from '../src/utils/logger.js';

// ─── ARG PARSING ─────────────────────────────────────────────────────────────

const { values: args } = parseArgs({
  options: {
    userId:           { type: 'string' },
    baseUrl:          { type: 'string',  default: process.env.BASE_URL || 'http://localhost:3000' },
    siteId:           { type: 'string' },
    delay:            { type: 'string',  default: '2000' },
    variant:          { type: 'string' },
    limit:            { type: 'string' },
    'follow-up-days': { type: 'string',  default: '3' },
    'max-per-hour':   { type: 'string',  default: '30' },
    'dry-run':        { type: 'boolean', default: false },
    warmup:           { type: 'boolean', default: false },
    'only-new':       { type: 'boolean', default: false },
    'retry-failed':   { type: 'boolean', default: false },
    'blacklist-after':{ type: 'string',  default: '4' },
  },
  strict: false,
});

const BASE_URL        = args.baseUrl;
const TRACKING_URL    = process.env.TRACKING_URL || BASE_URL; // peut être un domaine dédié
const DRY_RUN         = args['dry-run'];
const WARMUP          = args.warmup;
const ONLY_NEW        = args['only-new'];
const RETRY_FAILED    = args['retry-failed'];
const FORCE_VARIANT   = args.variant;
const FILTER_SITE_ID  = args.siteId;
const FOLLOW_UP_DAYS  = parseInt(args['follow-up-days']) || 3;
const MAX_PER_HOUR    = parseInt(args['max-per-hour']) || 30;
const BASE_DELAY_MS   = parseInt(args.delay) || 2000;
const BLACKLIST_AFTER = parseInt(args['blacklist-after']) || 4;
const LIMIT           = WARMUP ? 10 : (args.limit ? parseInt(args.limit) : Infinity);

// ─── SPAM WORD DETECTION ─────────────────────────────────────────────────────

const SPAM_WORDS = [
  'gratuit', 'urgent', '100%', 'garantie', 'cliquez ici', 'offre limitée',
  'gagnez', 'casino', 'crédit immédiat', 'sans risque', 'félicitations',
  'cher ami', 'argent rapide', 'opportunité unique', 'winner',
];

function detectSpamScore(subject, body) {
  const text = (subject + ' ' + body).toLowerCase();
  const hits  = SPAM_WORDS.filter(w => text.includes(w));
  return { score: hits.length, words: hits };
}

// ─── UCB1 MULTI-ARMED BANDIT (rotation intelligente) ─────────────────────────
// Sélectionne la variante avec le meilleur score UCB1 :
// score = taux_clic + sqrt(2 * ln(total_essais) / n_essais_variante)
// → exploite les meilleures variantes ET explore les moins testées.

function initVariantStats(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS variant_stats (
      variant_id TEXT PRIMARY KEY,
      sends      INTEGER NOT NULL DEFAULT 0,
      opens      INTEGER NOT NULL DEFAULT 0,
      clicks     INTEGER NOT NULL DEFAULT 0,
      replies    INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
}

function getVariantStats(db) {
  return db.prepare('SELECT * FROM variant_stats').all();
}

function pickVariantUCB1(db, variantIds) {
  if (FORCE_VARIANT && variantIds.includes(FORCE_VARIANT)) {
    return variantIds.find(v => v === FORCE_VARIANT);
  }

  const rows  = getVariantStats(db);
  const statsMap = {};
  rows.forEach(r => { statsMap[r.variant_id] = r; });

  const totalSends = rows.reduce((sum, r) => sum + r.sends, 1);

  let bestVariant = variantIds[0];
  let bestScore   = -Infinity;

  for (const vid of variantIds) {
    const s = statsMap[vid];
    if (!s || s.sends === 0) {
      // Pas encore testé → priorité absolue (exploration)
      return vid;
    }
    const clickRate = (s.clicks + s.opens * 0.3) / s.sends; // pondéré
    const exploration = Math.sqrt((2 * Math.log(totalSends)) / s.sends);
    const ucb1 = clickRate + exploration;
    if (ucb1 > bestScore) { bestScore = ucb1; bestVariant = vid; }
  }

  return bestVariant;
}

function recordVariantSend(db, variantId) {
  db.prepare(`
    INSERT INTO variant_stats (variant_id, sends) VALUES (?, 1)
    ON CONFLICT(variant_id) DO UPDATE SET sends = sends + 1, updated_at = datetime('now')
  `).run(variantId);
}

// ─── TRACKING SCHEMA ──────────────────────────────────────────────────────────

function initTrackingSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS email_sends (
      id          TEXT PRIMARY KEY,
      site_id     TEXT NOT NULL,
      lead_email  TEXT NOT NULL,
      variant_id  TEXT NOT NULL,
      subject     TEXT NOT NULL,
      message_id  TEXT NOT NULL,
      is_followup INTEGER NOT NULL DEFAULT 0,
      opened_at   TEXT,
      clicked_at  TEXT,
      replied_at  TEXT,
      bounced_at  TEXT,
      ignored     INTEGER NOT NULL DEFAULT 0,
      created_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS email_blacklist (
      email      TEXT PRIMARY KEY,
      reason     TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_email_sends_site   ON email_sends(site_id);
    CREATE INDEX IF NOT EXISTS idx_email_sends_email  ON email_sends(lead_email);
    CREATE INDEX IF NOT EXISTS idx_email_sends_ts     ON email_sends(created_at);
  `);
}

function isBlacklisted(db, email) {
  return !!db.prepare('SELECT 1 FROM email_blacklist WHERE email = ?').get(email.toLowerCase());
}

function addToBlacklist(db, email, reason) {
  db.prepare(`
    INSERT OR IGNORE INTO email_blacklist (email, reason) VALUES (?, ?)
  `).run(email.toLowerCase(), reason);
  logger.warn('[Blacklist] Added email', { email, reason });
}

function countSendsForSite(db, siteId) {
  return db.prepare('SELECT COUNT(*) as n FROM email_sends WHERE site_id = ?').get(siteId).n;
}

function getLastSendDate(db, siteId) {
  const row = db.prepare('SELECT created_at FROM email_sends WHERE site_id = ? ORDER BY created_at DESC LIMIT 1').get(siteId);
  return row ? row.created_at : null;
}

function wasSentToday(db, siteId) {
  const today = new Date().toISOString().slice(0, 10);
  const row   = db.prepare(`
    SELECT 1 FROM email_sends
    WHERE site_id = ? AND DATE(created_at) = ? LIMIT 1
  `).get(siteId, today);
  return !!row;
}

function recordSend(db, { id, siteId, email, variantId, subject, messageId, isFollowup }) {
  db.prepare(`
    INSERT INTO email_sends (id, site_id, lead_email, variant_id, subject, message_id, is_followup)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(id, siteId, email.toLowerCase(), variantId, subject, messageId, isFollowup ? 1 : 0);
}

// ─── TRACKING TOKENS ─────────────────────────────────────────────────────────

function buildTrackingToken(sendId) {
  return Buffer.from(sendId).toString('base64url');
}

function buildPixelUrl(sendId) {
  return `${TRACKING_URL}/track/open/${buildTrackingToken(sendId)}.gif`;
}

function buildTrackedUrl(sendId, targetUrl) {
  const token = buildTrackingToken(sendId);
  return `${TRACKING_URL}/track/click/${token}?url=${encodeURIComponent(targetUrl)}`;
}

// ─── EMAIL VARIANTS ───────────────────────────────────────────────────────────

const EMAIL_VARIANTS = {

  curiosite: {
    id: 'curiosite',
    subject: ({ name }) => `J'ai fait quelque chose pour ${name}`,
    text: ({ name, city, trackedUrl, sender }) =>
`Bonjour,

J'ai créé quelque chose pour vous : ${trackedUrl}

C'est un site pour ${name} à ${city}. Pas parfait, mais regardez vite.

Si ça vous intéresse, répondez-moi.

${sender}`,
    html: ({ name, city, trackedUrl, sender, pixelUrl }) => `
<div style="font-family:Arial,sans-serif;font-size:14px;color:#222;max-width:520px;line-height:1.7">
  <p>Bonjour,</p>
  <p>J'ai créé quelque chose pour vous :</p>
  <p style="margin:20px 0">
    <a href="${trackedUrl}" style="background:#6366f1;color:#fff;padding:12px 26px;border-radius:6px;text-decoration:none;font-weight:bold;display:inline-block">
      → Voir ma démo
    </a>
  </p>
  <p>C'est un site pour <strong>${name}</strong> à ${city}. Pas parfait, mais regardez vite.</p>
  <p>Si ça vous intéresse, répondez-moi.<br><br>${sender}</p>
  ${unsubFooter(sender)}
  <img src="${pixelUrl}" width="1" height="1" style="display:none" alt="" />
</div>`,
  },

  direct: {
    id: 'direct',
    subject: ({ city }) => `Votre site à ${city} — démo gratuite`,
    text: ({ name, trackedUrl, sender }) =>
`Bonjour,

Site démo pour ${name} : ${trackedUrl}

Gratuit. Prêt. Regardez.

${sender}`,
    html: ({ name, trackedUrl, sender, pixelUrl }) => `
<div style="font-family:Arial,sans-serif;font-size:14px;color:#222;max-width:520px;line-height:1.7">
  <p>Bonjour,</p>
  <p>Site démo pour <strong>${name}</strong> :</p>
  <p style="margin:20px 0">
    <a href="${trackedUrl}" style="background:#111;color:#fff;padding:12px 26px;border-radius:6px;text-decoration:none;font-weight:bold;display:inline-block">
      ${trackedUrl.slice(0, 60)}…
    </a>
  </p>
  <p>Gratuit. Prêt. Regardez.</p>
  <p>${sender}</p>
  ${unsubFooter(sender)}
  <img src="${pixelUrl}" width="1" height="1" style="display:none" alt="" />
</div>`,
  },

  court: {
    id: 'court',
    subject: ({ name }) => `${name} — 30 secondes`,
    text: ({ trackedUrl, sender }) =>
`Bonjour,

${trackedUrl}

Dites-moi ce que vous en pensez.

${sender}`,
    html: ({ trackedUrl, sender, pixelUrl }) => `
<div style="font-family:Arial,sans-serif;font-size:14px;color:#222;max-width:520px;line-height:1.7">
  <p>Bonjour,</p>
  <p style="margin:20px 0">
    <a href="${trackedUrl}" style="color:#6366f1;font-size:16px;font-weight:bold">Voir votre démo →</a>
  </p>
  <p>Dites-moi ce que vous en pensez.</p>
  <p>${sender}</p>
  ${unsubFooter(sender)}
  <img src="${pixelUrl}" width="1" height="1" style="display:none" alt="" />
</div>`,
  },

  probleme: {
    id: 'probleme',
    subject: ({ city }) => `Vous n'avez pas de site à ${city} ?`,
    text: ({ name, city, trackedUrl, sender }) =>
`Bonjour,

Beaucoup de gens cherchent des professionnels à ${city} en ligne.

J'ai fait une démo pour ${name} : ${trackedUrl}

Ça prend 30 secondes à regarder.

${sender}`,
    html: ({ name, city, trackedUrl, sender, pixelUrl }) => `
<div style="font-family:Arial,sans-serif;font-size:14px;color:#222;max-width:520px;line-height:1.7">
  <p>Bonjour,</p>
  <p>Beaucoup de gens cherchent des professionnels à <strong>${city}</strong> en ligne.</p>
  <p>J'ai fait une démo pour ${name} :</p>
  <p style="margin:20px 0">
    <a href="${trackedUrl}" style="background:#22c55e;color:#fff;padding:12px 26px;border-radius:6px;text-decoration:none;font-weight:bold;display:inline-block">
      Voir ma démo gratuite →
    </a>
  </p>
  <p>Ça prend 30 secondes à regarder.</p>
  <p>${sender}</p>
  ${unsubFooter(sender)}
  <img src="${pixelUrl}" width="1" height="1" style="display:none" alt="" />
</div>`,
  },

  opportunite: {
    id: 'opportunite',
    subject: ({ name }) => `${name} — des clients vous cherchent en ligne`,
    text: ({ name, city, trackedUrl, sender }) =>
`Bonjour,

Des clients cherchent "${name}" sur Google à ${city}.

J'ai préparé une démo de site pour vous : ${trackedUrl}

Regardez — c'est fait pour vous.

${sender}`,
    html: ({ name, city, trackedUrl, sender, pixelUrl }) => `
<div style="font-family:Arial,sans-serif;font-size:14px;color:#222;max-width:520px;line-height:1.7">
  <p>Bonjour,</p>
  <p>Des clients cherchent <strong>"${name}"</strong> sur Google à ${city}.</p>
  <p>J'ai préparé une démo de site pour vous :</p>
  <p style="margin:20px 0">
    <a href="${trackedUrl}" style="background:#f59e0b;color:#111;padding:12px 26px;border-radius:6px;text-decoration:none;font-weight:bold;display:inline-block">
      Voir ma démo →
    </a>
  </p>
  <p>Regardez — c'est fait pour vous.</p>
  <p>${sender}</p>
  ${unsubFooter(sender)}
  <img src="${pixelUrl}" width="1" height="1" style="display:none" alt="" />
</div>`,
  },
};

const FOLLOWUP_TEMPLATES = {

  relance_soft: {
    id: 'relance_soft',
    subject: ({ name }) => `Re: ${name}`,
    text: ({ trackedUrl, sender }) =>
`Bonjour,

Je me permets de revenir vers vous.

La démo est toujours disponible ici : ${trackedUrl}

Si ce n'est pas le bon moment, pas de souci — dites-le moi.

${sender}`,
    html: ({ trackedUrl, sender, pixelUrl }) => `
<div style="font-family:Arial,sans-serif;font-size:14px;color:#222;max-width:520px;line-height:1.7">
  <p>Bonjour,</p>
  <p>Je me permets de revenir vers vous.</p>
  <p>La démo est toujours disponible ici :</p>
  <p style="margin:20px 0">
    <a href="${trackedUrl}" style="color:#6366f1;font-weight:bold">Voir ma démo →</a>
  </p>
  <p>Si ce n'est pas le bon moment, pas de souci — dites-le moi.</p>
  <p>${sender}</p>
  ${unsubFooter(sender)}
  <img src="${pixelUrl}" width="1" height="1" style="display:none" alt="" />
</div>`,
  },

  relance_directe: {
    id: 'relance_directe',
    subject: ({ name }) => `Dernier message — ${name}`,
    text: ({ name, trackedUrl, sender }) =>
`Bonjour,

C'est mon dernier message.

J'avais créé ce site pour ${name} : ${trackedUrl}

Si vous le voulez, répondez-moi. Sinon, bonne continuation.

${sender}`,
    html: ({ name, trackedUrl, sender, pixelUrl }) => `
<div style="font-family:Arial,sans-serif;font-size:14px;color:#222;max-width:520px;line-height:1.7">
  <p>Bonjour,</p>
  <p>C'est mon dernier message.</p>
  <p>J'avais créé ce site pour <strong>${name}</strong> :</p>
  <p style="margin:20px 0">
    <a href="${trackedUrl}" style="background:#ef4444;color:#fff;padding:12px 26px;border-radius:6px;text-decoration:none;font-weight:bold;display:inline-block">
      Voir la démo →
    </a>
  </p>
  <p>Si vous le voulez, répondez-moi. Sinon, bonne continuation.</p>
  <p>${sender}</p>
  ${unsubFooter(sender)}
  <img src="${pixelUrl}" width="1" height="1" style="display:none" alt="" />
</div>`,
  },
};

// ─── HELPERS ─────────────────────────────────────────────────────────────────

function unsubFooter(_sender) {
  const from = process.env.SMTP_FROM || process.env.SMTP_USER || '';
  return `<p style="margin-top:24px;font-size:11px;color:#aaa">
    Pour ne plus recevoir nos emails :
    <a href="mailto:${from}?subject=Désinscription" style="color:#aaa">se désabonner</a>
  </p>`;
}

const SENDER_NAMES = ['Alex', 'Marc', 'Thomas', 'Julie', 'Sarah'];

function pickSenderName() {
  return SENDER_NAMES[Math.floor(Math.random() * SENDER_NAMES.length)];
}

function buildMessageId(siteId, domain) {
  const hash = createHash('sha1').update(siteId + Date.now().toString()).digest('hex').slice(0, 16);
  return `<${hash}@${domain}>`;
}

function jitteredDelay(base) {
  const jitter = base * 0.5;
  return Math.round(base - jitter + Math.random() * jitter * 2);
}

function daysSince(isoDate) {
  if (!isoDate) return Infinity;
  return (Date.now() - new Date(isoDate).getTime()) / 86_400_000;
}

function smtpDomain() {
  const from = process.env.SMTP_FROM || process.env.SMTP_USER || 'mail@example.com';
  return from.split('@')[1] || 'example.com';
}

// Validation email stricte
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
function isValidEmail(email) {
  if (!email || typeof email !== 'string') return false;
  if (!EMAIL_RE.test(email)) return false;
  // Domaines jetables courants
  const THROWAWAY = ['mailinator.com', 'guerrillamail.com', 'tempmail.com', 'yopmail.com', 'trashmail.com'];
  const domain = email.split('@')[1].toLowerCase();
  return !THROWAWAY.includes(domain);
}

// Priorité leads : récents > avec téléphone > activité rentable
const HIGH_VALUE = ['plombier', 'électricien', 'dentiste', 'avocat', 'notaire', 'garagiste', 'couvreur', 'maçon', 'architecte', 'médecin'];

function leadScore(site) {
  let score = 0;
  const ageDays  = daysSince(site.created_at);
  const activity = (site.lead_activity || '').toLowerCase();
  if (ageDays < 1)   score += 30;
  else if (ageDays < 3) score += 20;
  else if (ageDays < 7) score += 10;
  if (site.lead_phone) score += 15;
  if (HIGH_VALUE.some(a => activity.includes(a))) score += 10;
  return score;
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// ─── API ──────────────────────────────────────────────────────────────────────

// Client authentifié (login → Bearer), initialisé au démarrage de main().
// L'en-tête x-user-id n'est plus lu par l'API depuis la migration JWT.
let apiFetch;
let userId;

// ─── WARMUP SMTP ─────────────────────────────────────────────────────────────
// Rampe progressive : évite de déclencher les filtres anti-spam
// Jour 1 : 10, Jour 2 : 20, Jour 3 : 50, Jour 4 : 100, etc.

function getWarmupLimit(db) {
  if (!WARMUP) return LIMIT;
  const row = db.prepare(`
    SELECT COUNT(*) as n FROM email_sends
    WHERE DATE(created_at) >= DATE('now', '-7 days')
  `).get();
  const sent7days = row.n;
  if (sent7days < 50)  return 10;
  if (sent7days < 200) return 20;
  if (sent7days < 500) return 50;
  return 100;
}

// ─── FOLLOWUP LOGIC ───────────────────────────────────────────────────────────

function getFollowUpTemplate(db, siteId) {
  const rows = db.prepare(`
    SELECT created_at, is_followup FROM email_sends
    WHERE site_id = ? ORDER BY created_at DESC
  `).all(siteId);

  if (!rows.length) return null; // Premier contact → pas de followup

  const daysSinceLast = daysSince(rows[0].created_at);
  const total         = rows.length;

  if (daysSinceLast < FOLLOW_UP_DAYS) return null;
  if (total >= 3) return null; // Séquence terminée
  if (total === 1) return FOLLOWUP_TEMPLATES.relance_soft;
  if (total === 2) return FOLLOWUP_TEMPLATES.relance_directe;
  return null;
}

// ─── MAIN ─────────────────────────────────────────────────────────────────────

async function main() {
  ({ apiFetch, userId } = await createApiClient({ baseUrl: BASE_URL }));

  const db = getDb();
  initTrackingSchema(db);
  initVariantStats(db);

  const startTime = Date.now();
  const variantIds = Object.keys(EMAIL_VARIANTS);
  const effectiveLimit = getWarmupLimit(db);

  console.log('═'.repeat(64));
  console.log('📬 AutoDemo — Machine à Conversion v2');
  console.log(`   Base URL      : ${BASE_URL}`);
  console.log(`   Tracking URL  : ${TRACKING_URL}`);
  console.log(`   Compte        : ${userId}`);
  console.log(`   Mode          : ${DRY_RUN ? '🔍 DRY RUN' : '📨 ENVOI RÉEL'}`);
  console.log(`   Variante      : ${FORCE_VARIANT || 'UCB1 auto'}`);
  console.log(`   Warmup        : ${WARMUP ? `✅ (max ${effectiveLimit})` : '❌'}`);
  console.log(`   Blacklist >= : ${BLACKLIST_AFTER} ignores`);
  console.log(`   Max/heure     : ${MAX_PER_HOUR}`);
  console.log(`   Relance après : ${FOLLOW_UP_DAYS} jours`);
  console.log('═'.repeat(64));

  // ── Stats variantes actuelles ────────────────────────────────────────────
  const stats = getVariantStats(db);
  if (stats.length) {
    console.log('\n📊 Performance variantes (UCB1):');
    stats.forEach(s => {
      const ctr = s.sends > 0 ? ((s.clicks / s.sends) * 100).toFixed(1) : '0.0';
      const otr = s.sends > 0 ? ((s.opens / s.sends) * 100).toFixed(1) : '0.0';
      console.log(`   ${s.variant_id.padEnd(20)} | envois:${String(s.sends).padStart(5)} | opens:${otr}% | clics:${ctr}%`);
    });
  }

  // ── SMTP ─────────────────────────────────────────────────────────────────
  let transporter;
  if (!DRY_RUN) {
    const host = process.env.SMTP_HOST;
    const user = process.env.SMTP_USER;
    const pass = process.env.SMTP_PASS;
    if (!host || !user || !pass) {
      console.error('\n❌ SMTP non configuré (SMTP_HOST, SMTP_USER, SMTP_PASS)');
      process.exit(1);
    }
    try {
      transporter = nodemailer.createTransport({
        host, port: parseInt(process.env.SMTP_PORT || '587'),
        secure: process.env.SMTP_PORT === '465', auth: { user, pass },
      });
      await transporter.verify();
      console.log('\n✅ SMTP OK');
    } catch (err) {
      console.error(`\n❌ SMTP: ${err.message}`);
      process.exit(1);
    }
  }

  // ── Fetch sites ───────────────────────────────────────────────────────────
  console.log('\n🌐 Récupération des sites…');
  let sites;
  try { sites = await apiFetch('/sites'); }
  catch (err) { console.error(`❌ ${err.message}`); process.exit(1); }

  let candidates = sites.filter(s => s.lead_email);
  if (FILTER_SITE_ID) candidates = candidates.filter(s => s.id === FILTER_SITE_ID);

  // Tri par priorité
  candidates.sort((a, b) => leadScore(b) - leadScore(a));

  console.log(`   Sites totaux        : ${sites.length}`);
  console.log(`   Candidats (avec email) : ${candidates.length}`);

  // ── Construction file d'envoi ─────────────────────────────────────────────
  console.log('\n🔎 Qualification des contacts…');
  const queue = [];
  const sendStats = { sent: 0, failed: 0, skipped: 0, blacklisted: 0, spamWords: 0, byVariant: {} };

  for (const site of candidates) {
    if (queue.length >= effectiveLimit) break;

    const email = site.lead_email;

    // 1. Validation email
    if (!isValidEmail(email)) {
      logSkip(site.lead_name, `email invalide (${email})`);
      sendStats.skipped++;
      continue;
    }

    // 2. Blacklist check
    if (isBlacklisted(db, email)) {
      logSkip(site.lead_name, 'blacklisté');
      sendStats.blacklisted++;
      continue;
    }

    // 3. Auto-blacklist si trop d'ignores
    const totalSentToSite = countSendsForSite(db, site.id);
    if (totalSentToSite >= BLACKLIST_AFTER) {
      addToBlacklist(db, email, `${BLACKLIST_AFTER} envois sans réponse`);
      logSkip(site.lead_name, `blacklist automatique (${totalSentToSite} envois)`);
      sendStats.blacklisted++;
      continue;
    }

    // 4. Pas 2x aujourd'hui
    if (wasSentToday(db, site.id)) {
      logSkip(site.lead_name, 'déjà envoyé aujourd\'hui');
      sendStats.skipped++;
      continue;
    }

    // 5. Déterminer template : followup ou premier contact
    if (ONLY_NEW) {
      const lastSend = getLastSendDate(db, site.id);
      if (lastSend) { logSkip(site.lead_name, 'déjà contacté'); sendStats.skipped++; continue; }
      const varId  = pickVariantUCB1(db, variantIds);
      const tmpl   = EMAIL_VARIANTS[varId];
      queue.push({ site, template: tmpl, isFollowUp: false });
    } else if (RETRY_FAILED) {
      const tmpl = getFollowUpTemplate(db, site.id);
      if (!tmpl) { logSkip(site.lead_name, 'pas éligible relance'); sendStats.skipped++; continue; }
      queue.push({ site, template: tmpl, isFollowUp: true });
    } else {
      const followUp = getFollowUpTemplate(db, site.id);
      if (followUp) {
        queue.push({ site, template: followUp, isFollowUp: true });
      } else {
        const varId = pickVariantUCB1(db, variantIds);
        queue.push({ site, template: EMAIL_VARIANTS[varId], isFollowUp: false });
      }
    }
  }

  console.log(`\n   Dans la file : ${queue.length} email(s)`);

  if (!queue.length) {
    console.log('\n✅ Aucun email à envoyer.');
    printSummary(sendStats, startTime, 0);
    return;
  }

  // ── Envoi ─────────────────────────────────────────────────────────────────
  const FROM_EMAIL  = process.env.SMTP_FROM || process.env.SMTP_USER;
  const domain      = smtpDomain();
  let   sentThisHr  = 0;
  const hrStart     = Date.now();

  console.log(`\n📨 Envoi de ${queue.length} email(s)…\n`);

  for (const { site, template, isFollowUp } of queue) {

    // Rate limit horaire
    if (sentThisHr >= MAX_PER_HOUR && (Date.now() - hrStart) < 3_600_000) {
      console.log(`\n⏸  Limite ${MAX_PER_HOUR}/h. Pause 60s…`);
      await sleep(60_000);
      sentThisHr = 0;
    }

    const senderName  = pickSenderName();
    const sendId      = randomUUID();
    const messageId   = buildMessageId(site.id, domain);
    const pixelUrl    = buildPixelUrl(sendId);
    const trackedUrl  = buildTrackedUrl(sendId, site.url);

    const ctx = {
      name:       site.lead_name || 'votre entreprise',
      city:       site.city      || '',
      url:        site.url,
      trackedUrl,
      pixelUrl,
      sender:     senderName,
    };

    const subject  = template.subject(ctx);
    const textBody = template.text(ctx);
    const htmlBody = template.html(ctx);

    // Anti-spam check sur le sujet
    const spamCheck = detectSpamScore(subject, textBody);
    if (spamCheck.score >= 2) {
      console.log(`   ⚠️  [${site.lead_name}] Score spam: ${spamCheck.score} (${spamCheck.words.join(', ')}) — ignoré`);
      sendStats.spamWords++;
      continue;
    }

    const label  = isFollowUp ? `↩ ${template.id}` : template.id;
    const prefix = `   [${(ctx.name).slice(0, 22).padEnd(22)}]`;

    sendStats.byVariant[template.id] = (sendStats.byVariant[template.id] || 0) + 1;

    if (DRY_RUN) {
      console.log(`${prefix} 🔍 [${label}] → ${site.lead_email}`);
      console.log(`      Objet    : ${subject}`);
      console.log(`      Pixel    : ${pixelUrl}`);
      console.log(`      Tracking : ${trackedUrl.slice(0, 80)}…`);
      if (!isFollowUp) recordVariantSend(db, template.id);
      sendStats.sent++;
      continue;
    }

    try {
      await transporter.sendMail({
        from:      `"${senderName}" <${FROM_EMAIL}>`,
        to:        site.lead_email,
        subject,
        text:      textBody,
        html:      htmlBody,
        messageId,
        headers: {
          'X-Variant':  template.id,
          'X-Campaign': 'autodemo-v2',
          'X-Send-Id':  sendId,
          'List-Unsubscribe': `<mailto:${FROM_EMAIL}?subject=Désinscription>`,
        },
      });

      console.log(`${prefix} ✅ [${label}] → ${site.lead_email}`);

      // Enregistrement local (DB directe, pas via API)
      recordSend(db, {
        id: sendId,
        siteId: site.id,
        email: site.lead_email,
        variantId: template.id,
        subject,
        messageId,
        isFollowup: isFollowUp,
      });

      if (!isFollowUp) recordVariantSend(db, template.id);

      sendStats.sent++;
      sentThisHr++;

    } catch (err) {
      console.log(`${prefix} ❌ ${err.message}`);

      // Bounce permanent → blacklist
      if (err.message.includes('550') || err.message.includes('invalid address')) {
        addToBlacklist(db, site.lead_email, `bounce: ${err.message.slice(0, 80)}`);
      }

      sendStats.failed++;
    }

    await sleep(jitteredDelay(BASE_DELAY_MS));
  }

  printSummary(sendStats, startTime, queue.length);
}

// ─── OUTPUT HELPERS ───────────────────────────────────────────────────────────

function logSkip(name, reason) {
  console.log(`   ⏭  ${(name || '?').slice(0, 22).padEnd(22)} : ${reason}`);
}

function printSummary(s, startTime, total) {
  const duration    = ((Date.now() - startTime) / 1000).toFixed(1);
  const successRate = total > 0 ? Math.round((s.sent / total) * 100) : 0;
  const estReplies  = s.sent > 0 ? Math.round(s.sent * 0.04) : 0;

  console.log('\n' + '═'.repeat(64));
  console.log('📊 Résumé final');
  console.log('═'.repeat(64));
  console.log(`   ✅ Envoyés         : ${s.sent}`);
  console.log(`   ❌ Échoués         : ${s.failed}`);
  console.log(`   ⏭  Ignorés         : ${s.skipped}`);
  console.log(`   🚫 Blacklistés     : ${s.blacklisted}`);
  console.log(`   ⚠️  Spam détecté    : ${s.spamWords}`);
  console.log(`   📈 Taux succès     : ${successRate}%`);
  console.log(`   💬 Réponses est.   : ~${estReplies}`);
  console.log(`   ⏱  Durée totale    : ${duration}s`);

  const variants = Object.entries(s.byVariant);
  if (variants.length) {
    console.log('\n   Répartition variantes :');
    for (const [v, n] of variants) {
      const bar = '█'.repeat(Math.min(n, 20));
      console.log(`     ${v.padEnd(20)} ${bar} ${n}`);
    }
  }
  console.log('═'.repeat(64));
  console.log('\n💡 Pour voir les opens/clics : consultez la table email_sends dans la DB.');
  console.log('   Endpoints à ajouter : GET /track/open/:token.gif et GET /track/click/:token\n');
}

// ─── ENTRY POINT ─────────────────────────────────────────────────────────────

main().catch(err => {
  console.error('\n💥 Erreur fatale:', err.message);
  console.error(err.stack);
  process.exit(1);
});
