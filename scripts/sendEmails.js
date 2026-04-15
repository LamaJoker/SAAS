/**
 * sendEmails.js — Machine à conversion professionnelle
 *
 * Fonctionnalités :
 *   - 5 variantes A/B + 2 templates de relance
 *   - Tracking backend (email_sent, email_failed, variant_used)
 *   - Anti-spam : délai aléatoire, rotation FROM, Message-ID custom
 *   - Priorisation leads (récents > avec téléphone > activité rentable)
 *   - Multi-touch : relance soft + directe après X jours
 *   - Smart sending : pas 2x/jour, limite horaire, logs détaillés
 *   - Warmup mode (--warmup : max 10 emails)
 *
 * Usage :
 *   node scripts/sendEmails.js --userId <ID>
 *   node scripts/sendEmails.js --userId <ID> --dry-run
 *   node scripts/sendEmails.js --userId <ID> --limit 50 --warmup
 *   node scripts/sendEmails.js --userId <ID> --only-new
 *   node scripts/sendEmails.js --userId <ID> --retry-failed
 *   node scripts/sendEmails.js --userId <ID> --variant direct
 *   node scripts/sendEmails.js --userId <ID> --follow-up-days 5 --max-per-hour 20
 */

import nodemailer from 'nodemailer';
import { parseArgs } from 'node:util';
import { randomUUID } from 'node:crypto';

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
    'warmup':         { type: 'boolean', default: false },
    'only-new':       { type: 'boolean', default: false },
    'retry-failed':   { type: 'boolean', default: false },
  },
  strict: false,
});

const USER_ID        = args.userId    || process.env.USER_ID;
const BASE_URL       = args.baseUrl;
const DRY_RUN        = args['dry-run'];
const WARMUP         = args['warmup'];
const ONLY_NEW       = args['only-new'];
const RETRY_FAILED   = args['retry-failed'];
const FORCE_VARIANT  = args.variant;
const FILTER_SITE_ID = args.siteId;
const FOLLOW_UP_DAYS = parseInt(args['follow-up-days']) || 3;
const MAX_PER_HOUR   = parseInt(args['max-per-hour']) || 30;
const BASE_DELAY_MS  = parseInt(args.delay) || 2000;
const LIMIT          = WARMUP ? 10 : (args.limit ? parseInt(args.limit) : Infinity);

if (!USER_ID) {
  console.error('❌  userId requis. Usage: node scripts/sendEmails.js --userId <ID>');
  process.exit(1);
}

// ─── ANTI-SPAM HELPERS ────────────────────────────────────────────────────────

/** Noms d'expéditeur en rotation pour humaniser les envois */
const SENDER_NAMES = ['Alex', 'Marc', 'Thomas', 'Julie', 'Sarah'];

function pickSenderName() {
  return SENDER_NAMES[Math.floor(Math.random() * SENDER_NAMES.length)];
}

/** Message-ID unique par domaine pour éviter les doublons détectés par les filtres */
function buildMessageId(domain) {
  const rand = randomUUID().replace(/-/g, '').slice(0, 16);
  const ts   = Date.now().toString(36);
  return `<${ts}.${rand}@${domain}>`;
}

/** Délai aléatoire ± 50% autour du délai de base (simule un humain) */
function jitteredDelay(base) {
  const jitter = base * 0.5;
  return Math.round(base - jitter + Math.random() * jitter * 2);
}

// ─── EMAIL VARIANTS ───────────────────────────────────────────────────────────

const EMAIL_VARIANTS = {

  // Variante 1 — Curiosité : on montre avant d'expliquer
  curiosite: {
    id: 'curiosite',
    subject: ({ name }) => `J'ai fait quelque chose pour ${name}`,
    text: ({ name, city, url, sender }) =>
`Bonjour,

J'ai créé quelque chose pour vous : ${url}

C'est un site pour ${name} à ${city}. Pas parfait, mais regardez vite.

Si ça vous intéresse, répondez-moi.

${sender}`,
    html: ({ name, city, url, sender }) => `
<div style="font-family:Arial,sans-serif;font-size:14px;color:#222;max-width:520px;line-height:1.7">
  <p>Bonjour,</p>
  <p>J'ai créé quelque chose pour vous :</p>
  <p style="margin:20px 0">
    <a href="${url}" style="background:#6366f1;color:#fff;padding:12px 26px;border-radius:6px;text-decoration:none;font-weight:bold;display:inline-block">
      → Voir ma démo
    </a>
  </p>
  <p>C'est un site pour <strong>${name}</strong> à ${city}. Pas parfait, mais regardez vite.</p>
  <p>Si ça vous intéresse, répondez-moi.<br><br>${sender}</p>
  ${unsubFooter()}
</div>`,
  },

  // Variante 2 — Direct : aucun blabla
  direct: {
    id: 'direct',
    subject: ({ city }) => `Votre site à ${city} — démo gratuite`,
    text: ({ name, url, sender }) =>
`Bonjour,

Site démo pour ${name} : ${url}

Gratuit. Prêt. Regardez.

${sender}`,
    html: ({ name, url, sender }) => `
<div style="font-family:Arial,sans-serif;font-size:14px;color:#222;max-width:520px;line-height:1.7">
  <p>Bonjour,</p>
  <p>Site démo pour <strong>${name}</strong> :</p>
  <p style="margin:20px 0">
    <a href="${url}" style="background:#111;color:#fff;padding:12px 26px;border-radius:6px;text-decoration:none;font-weight:bold;display:inline-block">
      ${url}
    </a>
  </p>
  <p>Gratuit. Prêt. Regardez.</p>
  <p>${sender}</p>
  ${unsubFooter()}
</div>`,
  },

  // Variante 3 — Ultra court : 3 lignes
  court: {
    id: 'court',
    subject: ({ name }) => `${name} — 30 secondes`,
    text: ({ url, sender }) =>
`Bonjour,

${url}

Dites-moi ce que vous en pensez.

${sender}`,
    html: ({ url, sender }) => `
<div style="font-family:Arial,sans-serif;font-size:14px;color:#222;max-width:520px;line-height:1.7">
  <p>Bonjour,</p>
  <p style="margin:20px 0">
    <a href="${url}" style="color:#6366f1;font-size:16px;font-weight:bold">${url}</a>
  </p>
  <p>Dites-moi ce que vous en pensez.</p>
  <p>${sender}</p>
  ${unsubFooter()}
</div>`,
  },

  // Variante 4 — Problème : angle "pas de site"
  probleme: {
    id: 'probleme',
    subject: ({ city }) => `Vous n'avez pas de site à ${city} ?`,
    text: ({ name, city, url, sender }) =>
`Bonjour,

Beaucoup de gens cherchent des professionnels à ${city} en ligne.

J'ai fait une démo pour ${name} : ${url}

Ça prend 30 secondes à regarder.

${sender}`,
    html: ({ name, city, url, sender }) => `
<div style="font-family:Arial,sans-serif;font-size:14px;color:#222;max-width:520px;line-height:1.7">
  <p>Bonjour,</p>
  <p>Beaucoup de gens cherchent des professionnels à <strong>${city}</strong> en ligne.</p>
  <p>J'ai fait une démo pour ${name} :</p>
  <p style="margin:20px 0">
    <a href="${url}" style="background:#22c55e;color:#fff;padding:12px 26px;border-radius:6px;text-decoration:none;font-weight:bold;display:inline-block">
      Voir ma démo gratuite →
    </a>
  </p>
  <p>Ça prend 30 secondes à regarder.</p>
  <p>${sender}</p>
  ${unsubFooter()}
</div>`,
  },

  // Variante 5 — Opportunité : angle ROI / clients Google
  opportunite: {
    id: 'opportunite',
    subject: ({ name }) => `${name} — des clients vous cherchent en ligne`,
    text: ({ name, city, url, sender }) =>
`Bonjour,

Des clients cherchent "${name}" sur Google à ${city}.

J'ai préparé une démo de site pour vous : ${url}

Regardez — c'est fait pour vous.

${sender}`,
    html: ({ name, city, url, sender }) => `
<div style="font-family:Arial,sans-serif;font-size:14px;color:#222;max-width:520px;line-height:1.7">
  <p>Bonjour,</p>
  <p>Des clients cherchent <strong>"${name}"</strong> sur Google à ${city}.</p>
  <p>J'ai préparé une démo de site pour vous :</p>
  <p style="margin:20px 0">
    <a href="${url}" style="background:#f59e0b;color:#111;padding:12px 26px;border-radius:6px;text-decoration:none;font-weight:bold;display:inline-block">
      Voir ma démo →
    </a>
  </p>
  <p>Regardez — c'est fait pour vous.</p>
  <p>${sender}</p>
  ${unsubFooter()}
</div>`,
  },
};

// ─── FOLLOW-UP TEMPLATES ──────────────────────────────────────────────────────

const FOLLOWUP_TEMPLATES = {

  // Relance 1 — Soft : ton neutre, porte de sortie offerte
  relance_soft: {
    id: 'relance_soft',
    subject: ({ name }) => `Re: ${name}`,
    text: ({ url, sender }) =>
`Bonjour,

Je me permets de revenir vers vous.

La démo est toujours disponible ici : ${url}

Si ce n'est pas le bon moment, pas de souci — dites-le moi.

${sender}`,
    html: ({ url, sender }) => `
<div style="font-family:Arial,sans-serif;font-size:14px;color:#222;max-width:520px;line-height:1.7">
  <p>Bonjour,</p>
  <p>Je me permets de revenir vers vous.</p>
  <p>La démo est toujours disponible ici :</p>
  <p style="margin:20px 0">
    <a href="${url}" style="color:#6366f1;font-weight:bold">${url}</a>
  </p>
  <p>Si ce n'est pas le bon moment, pas de souci — dites-le moi.</p>
  <p>${sender}</p>
  ${unsubFooter()}
</div>`,
  },

  // Relance 2 — Directe : dernier message, urgence
  relance_directe: {
    id: 'relance_directe',
    subject: ({ name }) => `Dernier message — ${name}`,
    text: ({ name, url, sender }) =>
`Bonjour,

C'est mon dernier message.

J'avais créé ce site pour ${name} : ${url}

Si vous le voulez, répondez-moi. Sinon, bonne continuation.

${sender}`,
    html: ({ name, url, sender }) => `
<div style="font-family:Arial,sans-serif;font-size:14px;color:#222;max-width:520px;line-height:1.7">
  <p>Bonjour,</p>
  <p>C'est mon dernier message.</p>
  <p>J'avais créé ce site pour <strong>${name}</strong> :</p>
  <p style="margin:20px 0">
    <a href="${url}" style="background:#ef4444;color:#fff;padding:12px 26px;border-radius:6px;text-decoration:none;font-weight:bold;display:inline-block">
      Voir la démo →
    </a>
  </p>
  <p>Si vous le voulez, répondez-moi. Sinon, bonne continuation.</p>
  <p>${sender}</p>
  ${unsubFooter()}
</div>`,
  },
};

// ─── STATIC HELPERS ───────────────────────────────────────────────────────────

function unsubFooter() {
  const from = process.env.SMTP_FROM || process.env.SMTP_USER || '';
  return `<p style="margin-top:24px;font-size:11px;color:#aaa">
    Pour ne plus recevoir nos emails :
    <a href="mailto:${from}?subject=Désabonnement" style="color:#aaa">se désabonner</a>
  </p>`;
}

const VARIANT_KEYS = Object.keys(EMAIL_VARIANTS);

function pickVariant() {
  if (FORCE_VARIANT && EMAIL_VARIANTS[FORCE_VARIANT]) return EMAIL_VARIANTS[FORCE_VARIANT];
  return EMAIL_VARIANTS[VARIANT_KEYS[Math.floor(Math.random() * VARIANT_KEYS.length)]];
}

function daysSince(isoDate) {
  if (!isoDate) return Infinity;
  return (Date.now() - new Date(isoDate).getTime()) / 86_400_000;
}

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

function smtpDomain() {
  const from = process.env.SMTP_FROM || process.env.SMTP_USER || 'mail@example.com';
  return from.split('@')[1] || 'example.com';
}

// ─── LEAD PRIORITIZATION ──────────────────────────────────────────────────────

const HIGH_VALUE_ACTIVITIES = [
  'plombier', 'électricien', 'dentiste', 'avocat', 'notaire',
  'garagiste', 'couvreur', 'maçon', 'architecte', 'médecin',
];

function leadScore(site) {
  let score = 0;
  const ageDays  = daysSince(site.created_at);
  const activity = (site.lead_activity || '').toLowerCase();

  // Récents en tête
  if (ageDays < 1)       score += 30;
  else if (ageDays < 3)  score += 20;
  else if (ageDays < 7)  score += 10;

  // Téléphone disponible = plus convertible
  if (site.lead_phone)   score += 15;

  // Activité à forte valeur perçue
  if (HIGH_VALUE_ACTIVITIES.some(a => activity.includes(a))) score += 10;

  return score;
}

// ─── API HELPERS ──────────────────────────────────────────────────────────────

async function apiFetch(path, options = {}) {
  const res = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'x-user-id': USER_ID,
      ...(options.headers || {}),
    },
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status} on ${path}`);
  return data.data;
}

/**
 * Enregistre un event de tracking côté backend.
 * Non bloquant : un échec de tracking ne stoppe pas l'envoi.
 */
async function trackEvent(type, payload) {
  if (DRY_RUN) return;
  try {
    await apiFetch('/events', {
      method: 'POST',
      body: JSON.stringify({ type, userId: USER_ID, ...payload }),
    });
  } catch (err) {
    console.warn(`     ⚠️  Tracking échoué (${type}): ${err.message}`);
  }
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// ─── SMART SENDING GUARDS ─────────────────────────────────────────────────────

/**
 * Vérifie si un email a déjà été envoyé aujourd'hui pour ce site.
 */
async function sentToday(siteId) {
  try {
    const events = await apiFetch(`/events?siteId=${siteId}&type=email_sent&date=${todayStr()}`);
    return Array.isArray(events) && events.length > 0;
  } catch {
    return false; // En cas d'erreur API, on laisse passer (non bloquant)
  }
}

/**
 * Détermine si un contact est éligible à une relance.
 * Retourne le template approprié ou null.
 *
 * Séquence :
 *   0 envoi  → premier contact (géré ailleurs)
 *   1 envoi  → relance_soft après FOLLOW_UP_DAYS jours
 *   2 envois → relance_directe après FOLLOW_UP_DAYS jours supplémentaires
 *   3+ envois → stop (ne plus contacter)
 */
async function getFollowUpTemplate(siteId) {
  try {
    const events = await apiFetch(`/events?siteId=${siteId}&type=email_sent`);
    if (!Array.isArray(events) || events.length === 0) return null;

    const sorted       = events.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    const daysSinceLast = daysSince(sorted[0].created_at);
    const totalSent    = events.length;

    if (daysSinceLast < FOLLOW_UP_DAYS) return null;    // Trop tôt
    if (totalSent >= 3)                  return null;    // Séquence terminée
    if (totalSent === 1) return FOLLOWUP_TEMPLATES.relance_soft;
    if (totalSent === 2) return FOLLOWUP_TEMPLATES.relance_directe;
    return null;
  } catch {
    return null;
  }
}

// ─── SMTP SETUP ───────────────────────────────────────────────────────────────

function createTransporter() {
  const host = process.env.SMTP_HOST;
  const port = parseInt(process.env.SMTP_PORT || '587');
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  if (!host || !user || !pass) {
    throw new Error('Variables SMTP manquantes (SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS)');
  }

  return nodemailer.createTransport({ host, port, secure: port === 465, auth: { user, pass } });
}

// ─── MAIN ─────────────────────────────────────────────────────────────────────

async function main() {
  const startTime = Date.now();

  console.log('═'.repeat(62));
  console.log('📬 AutoDemo — Machine à Conversion');
  console.log(`   Base URL      : ${BASE_URL}`);
  console.log(`   User ID       : ${USER_ID}`);
  console.log(`   Mode          : ${DRY_RUN ? '🔍 DRY RUN' : '📨 ENVOI RÉEL'}`);
  console.log(`   Variante      : ${FORCE_VARIANT || 'aléatoire'}`);
  console.log(`   Warmup        : ${WARMUP ? `✅ (max 10)` : '❌'}`);
  console.log(`   Seulement new : ${ONLY_NEW ? '✅' : '❌'}`);
  console.log(`   Relances      : ${RETRY_FAILED ? '✅' : '❌'}`);
  console.log(`   Limite        : ${isFinite(LIMIT) ? LIMIT : '∞'}`);
  console.log(`   Max/heure     : ${MAX_PER_HOUR}`);
  console.log(`   Délai base    : ${BASE_DELAY_MS}ms ± 50%`);
  console.log(`   Relance après : ${FOLLOW_UP_DAYS} jours`);
  console.log('═'.repeat(62));

  // ── SMTP ────────────────────────────────────────────────────────────────────
  let transporter;
  if (!DRY_RUN) {
    try {
      transporter = createTransporter();
      await transporter.verify();
      console.log('\n✅ Connexion SMTP OK');
    } catch (err) {
      console.error(`\n❌ SMTP: ${err.message}`);
      process.exit(1);
    }
  }

  // ── Fetch sites ─────────────────────────────────────────────────────────────
  console.log('\n🌐 Récupération des sites…');
  let sites;
  try {
    sites = await apiFetch('/sites');
  } catch (err) {
    console.error(`❌ ${err.message}`);
    process.exit(1);
  }

  let candidates = sites.filter(s => s.lead_email?.includes('@'));
  if (FILTER_SITE_ID) candidates = candidates.filter(s => s.id === FILTER_SITE_ID);

  console.log(`   Sites totaux      : ${sites.length}`);
  console.log(`   Avec email valide : ${candidates.length}`);

  // ── Priorisation ─────────────────────────────────────────────────────────────
  candidates.sort((a, b) => leadScore(b) - leadScore(a));

  // ── Construction de la file d'envoi ──────────────────────────────────────────
  console.log('\n🔎 Analyse des contacts…');
  const queue = []; // { site, template, isFollowUp }
  const stats = { sent: 0, failed: 0, skipped: 0, byVariant: {} };

  for (const site of candidates) {
    if (queue.length >= LIMIT) break;

    // Garde : pas 2 envois le même jour
    const alreadyToday = await sentToday(site.id);
    if (alreadyToday) {
      logSkip(site.lead_name, 'déjà envoyé aujourd\'hui');
      stats.skipped++;
      continue;
    }

    if (ONLY_NEW) {
      // Mode --only-new : premier contact uniquement
      const followUp = await getFollowUpTemplate(site.id);
      if (followUp !== null) {
        logSkip(site.lead_name, 'déjà contacté');
        stats.skipped++;
        continue;
      }
      queue.push({ site, template: pickVariant(), isFollowUp: false });

    } else if (RETRY_FAILED) {
      // Mode --retry-failed : relances uniquement
      const followUp = await getFollowUpTemplate(site.id);
      if (!followUp) {
        logSkip(site.lead_name, 'pas éligible à une relance');
        stats.skipped++;
        continue;
      }
      queue.push({ site, template: followUp, isFollowUp: true });

    } else {
      // Mode normal : premier contact OU relance si éligible
      const followUp = await getFollowUpTemplate(site.id);
      if (followUp) {
        queue.push({ site, template: followUp, isFollowUp: true });
      } else {
        queue.push({ site, template: pickVariant(), isFollowUp: false });
      }
    }
  }

  console.log(`\n   Dans la file      : ${queue.length} email(s) à envoyer`);

  if (queue.length === 0) {
    console.log('\n✅ Aucun email à envoyer.');
    printSummary(stats, startTime, 0);
    return;
  }

  // ── Envoi ────────────────────────────────────────────────────────────────────
  const FROM_EMAIL   = process.env.SMTP_FROM || process.env.SMTP_USER;
  const domain       = smtpDomain();
  let   sentThisHour = 0;
  const hourStart    = Date.now();

  console.log(`\n📨 Envoi de ${queue.length} email(s)…\n`);

  for (const { site, template, isFollowUp } of queue) {

    // Limite horaire : pause si plafond atteint
    if (sentThisHour >= MAX_PER_HOUR && (Date.now() - hourStart) < 3_600_000) {
      console.log(`\n⏸  Limite horaire (${MAX_PER_HOUR}/h) atteinte. Pause 60s…`);
      await sleep(60_000);
      sentThisHour = 0;
    }

    const senderName = pickSenderName();
    const ctx = {
      name:   site.lead_name   || 'votre entreprise',
      city:   site.city        || '',
      url:    site.url,
      sender: senderName,
    };

    const subject   = template.subject(ctx);
    const textBody  = template.text(ctx);
    const htmlBody  = template.html(ctx);
    const messageId = buildMessageId(domain);
    const label     = isFollowUp ? `↩ ${template.id}` : template.id;
    const prefix    = `   [${ctx.name.slice(0, 22).padEnd(22)}]`;

    stats.byVariant[template.id] = (stats.byVariant[template.id] || 0) + 1;

    if (DRY_RUN) {
      console.log(`${prefix} 🔍 [${label}] → ${site.lead_email}`);
      console.log(`      Objet  : ${subject}`);
      console.log(`      From   : ${senderName} <${FROM_EMAIL}>`);
      stats.sent++;
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
          'X-Campaign': 'autodemo',
          'X-Lead-Id':  site.lead_id || '',
        },
      });

      console.log(`${prefix} ✅ [${label}] → ${site.lead_email}`);

      // Tracking backend : email envoyé
      await trackEvent('email_sent', {
        leadId: site.lead_id,
        siteId: site.id,
        meta:   JSON.stringify({ variant: template.id, isFollowUp, subject }),
      });

      stats.sent++;
      sentThisHour++;

    } catch (err) {
      console.log(`${prefix} ❌ ${err.message}`);

      // Tracking backend : échec
      await trackEvent('email_failed', {
        leadId: site.lead_id,
        siteId: site.id,
        meta:   JSON.stringify({ error: err.message, variant: template.id }),
      });

      stats.failed++;
    }

    // Délai aléatoire ± 50%
    await sleep(jitteredDelay(BASE_DELAY_MS));
  }

  printSummary(stats, startTime, queue.length);
}

// ─── OUTPUT HELPERS ───────────────────────────────────────────────────────────

function logSkip(name, reason) {
  console.log(`   ⏭  ${(name || '?').slice(0, 22).padEnd(22)} : ${reason}`);
}

function printSummary(stats, startTime, total) {
  const duration    = ((Date.now() - startTime) / 1000).toFixed(1);
  const successRate = total > 0 ? Math.round((stats.sent / total) * 100) : 0;
  const estReplies  = stats.sent > 0 ? Math.round(stats.sent * 0.04) : 0; // ~4% reply B2B

  console.log('\n' + '═'.repeat(62));
  console.log('📊 Résumé final');
  console.log('═'.repeat(62));
  console.log(`   ✅ Envoyés        : ${stats.sent}`);
  console.log(`   ❌ Échoués        : ${stats.failed}`);
  console.log(`   ⏭  Ignorés        : ${stats.skipped}`);
  console.log(`   📈 Taux succès    : ${successRate}%`);
  console.log(`   💬 Réponses est.  : ~${estReplies} (base 4% B2B cold)`);
  console.log(`   ⏱  Durée totale   : ${duration}s`);

  const variants = Object.entries(stats.byVariant);
  if (variants.length > 0) {
    console.log('\n   Répartition des variantes :');
    for (const [v, n] of variants) {
      const bar = '█'.repeat(Math.min(n, 20));
      console.log(`     ${v.padEnd(18)} ${bar} ${n}`);
    }
  }

  console.log('═'.repeat(62));
}

// ─── ENTRY POINT ─────────────────────────────────────────────────────────────

main().catch(err => {
  console.error('\n💥 Erreur fatale:', err.message);
  process.exit(1);
});
