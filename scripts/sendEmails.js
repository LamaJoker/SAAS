/**
 * sendEmails.js — Envoi optimisé avec rotation de templates, délais aléatoires,
 * personnalisation forte et logs détaillés.
 *
 * Usage:
 *   node scripts/sendEmails.js --userId <USER_ID>
 *   node scripts/sendEmails.js --userId <USER_ID> --dry-run
 *   node scripts/sendEmails.js --userId <USER_ID> --siteId <SITE_ID>
 *   node scripts/sendEmails.js --userId <USER_ID> --template 0  (force template index)
 */

import nodemailer from 'nodemailer';
import { parseArgs } from 'node:util';

// ─── ARG PARSING ─────────────────────────────────────────────────────────────

const { values: args } = parseArgs({
  options: {
    userId:     { type: 'string' },
    baseUrl:    { type: 'string', default: process.env.BASE_URL || 'http://localhost:3000' },
    siteId:     { type: 'string' },
    delay:      { type: 'string', default: '3000' },
    'dry-run':  { type: 'boolean', default: false },
    template:   { type: 'string' },   // force template index (0,1,2)
  },
  strict: false,
});

const USER_ID        = args.userId  || process.env.USER_ID;
const BASE_URL       = args.baseUrl;
const DRY_RUN        = args['dry-run'];
const BASE_DELAY_MS  = Math.max(500, parseInt(args.delay) || 3000);
const FILTER_SITE_ID = args.siteId;
const FORCE_TEMPLATE = args.template !== undefined ? parseInt(args.template) : null;

if (!USER_ID) {
  console.error('❌  userId requis. Usage: node scripts/sendEmails.js --userId <ID>');
  process.exit(1);
}

// ─── SUBJECT VARIANTS ─────────────────────────────────────────────────────────

/**
 * Trois sujets courts testés pour maximiser le taux d'ouverture.
 * On tourne pour éviter les filtres antispam et mesurer ce qui marche.
 */
const SUBJECT_VARIANTS = [
  (name, city) => `${name} — votre site est prêt`,
  (name, city) => `J'ai créé quelque chose pour vous à ${city}`,
  (name, city) => `Votre démo gratuite est en ligne (2 min à consulter)`,
];

// ─── EMAIL TEMPLATES ──────────────────────────────────────────────────────────

/**
 * Template 0 — Direct & professionnel
 * Angle : "on l'a fait pour vous, regardez"
 */
function buildTemplate0({ name, city, activity, url, sender }) {
  const subject = SUBJECT_VARIANTS[0](name, city);

  const text = `Bonjour,

J'ai créé une démo de site web pour ${name} à ${city}.

Elle est disponible ici : ${url}

Ça prend 2 minutes à regarder. Si ça vous intéresse, répondez à cet email.

${sender}`;

  const html = `<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8">
<style>
  body{margin:0;padding:0;background:#f5f5f5;font-family:Arial,sans-serif}
  .w{max-width:520px;margin:0 auto;padding:20px}
  .c{background:#fff;border-radius:6px;padding:32px;border-top:3px solid #2563eb}
  p{color:#374151;font-size:15px;line-height:1.7;margin:0 0 16px}
  .cta{display:block;background:#2563eb;color:#fff;text-decoration:none;
       padding:14px 0;text-align:center;border-radius:6px;font-size:15px;
       font-weight:bold;margin:24px 0}
  small{color:#9ca3af;font-size:12px}
</style>
</head><body><div class="w"><div class="c">
  <p>Bonjour,</p>
  <p>J'ai créé une démo de site web pour <strong>${name}</strong> (${activity}) à <strong>${city}</strong>.</p>
  <p>Ça prend <strong>2 minutes</strong> à regarder :</p>
  <a href="${url}" class="cta">→ Voir ma démo gratuite</a>
  <p>Si ça vous intéresse, répondez simplement à cet email.</p>
  <p>Bonne journée,<br><strong>${sender}</strong></p>
  <small>Pour ne plus recevoir nos messages : <a href="mailto:${process.env.SMTP_FROM}?subject=Désabonnement">se désabonner</a></small>
</div></div></body></html>`;

  return { subject, text, html };
}

/**
 * Template 1 — Curiosité & intrigue
 * Angle : "votre concurrent a déjà ça"
 */
function buildTemplate1({ name, city, activity, url, sender }) {
  const subject = SUBJECT_VARIANTS[1](name, city);

  const text = `Bonjour,

Les ${activity}s de ${city} qui ont un bon site web reçoivent 3x plus de contacts.

J'en ai créé un pour ${name} — gratuit, sans engagement.

Consultez-le ici : ${url}

Répondez si vous voulez en discuter.

${sender}`;

  const html = `<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8">
<style>
  body{margin:0;padding:0;background:#f5f5f5;font-family:Arial,sans-serif}
  .w{max-width:520px;margin:0 auto;padding:20px}
  .c{background:#fff;border-radius:6px;padding:32px}
  .banner{background:#fef3c7;border-left:4px solid #f59e0b;padding:12px 16px;
          border-radius:4px;margin-bottom:20px}
  .banner p{margin:0;color:#92400e;font-size:14px;font-weight:600}
  p{color:#374151;font-size:15px;line-height:1.7;margin:0 0 16px}
  .cta{display:block;background:#2563eb;color:#fff;text-decoration:none;
       padding:14px 0;text-align:center;border-radius:6px;font-size:15px;
       font-weight:bold;margin:24px 0}
  small{color:#9ca3af;font-size:12px}
</style>
</head><body><div class="w"><div class="c">
  <div class="banner"><p>💡 Les ${activity}s avec un site reçoivent 3× plus de contacts</p></div>
  <p>Bonjour,</p>
  <p>J'ai créé une démo de site pour <strong>${name}</strong> à <strong>${city}</strong>. C'est gratuit, sans engagement.</p>
  <a href="${url}" class="cta">→ Voir mon site en 2 minutes</a>
  <p>Si ce n'est pas le bon moment, pas de souci. Répondez juste "pas intéressé".</p>
  <p>Bonne journée,<br><strong>${sender}</strong></p>
  <small><a href="mailto:${process.env.SMTP_FROM}?subject=Désabonnement">Se désabonner</a></small>
</div></div></body></html>`;

  return { subject, text, html };
}

/**
 * Template 2 — Ultra court (texte brut simulé)
 * Angle : email "personnel", pas de marketing visible
 */
function buildTemplate2({ name, city, activity, url, sender }) {
  const subject = SUBJECT_VARIANTS[2](name, city);

  const text = `Bonjour,

J'ai fait une démo de site pour vous : ${url}

C'est pour ${name}, ${activity} à ${city}.

Ça vous intéresse ?

${sender}`;

  // Volontairement simple — ressemble à un email perso
  const html = `<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8">
<style>
  body{margin:0;padding:0;background:#fff;font-family:Georgia,serif}
  .w{max-width:500px;margin:0 auto;padding:40px 20px}
  p{color:#1f2937;font-size:15px;line-height:1.8;margin:0 0 18px}
  a.link{color:#2563eb}
  small{color:#9ca3af;font-size:12px}
</style>
</head><body><div class="w">
  <p>Bonjour,</p>
  <p>J'ai créé une démo de site web pour <strong>${name}</strong> (${activity}, ${city}).</p>
  <p>Vous pouvez la consulter ici : <a href="${url}" class="link">${url}</a></p>
  <p>Ça vous intéresse ?</p>
  <p>—<br><strong>${sender}</strong></p>
  <small><a href="mailto:${process.env.SMTP_FROM}?subject=Désabonnement">Se désabonner</a></small>
</div></body></html>`;

  return { subject, text, html };
}

const TEMPLATES = [buildTemplate0, buildTemplate1, buildTemplate2];

// ─── SMTP SETUP ───────────────────────────────────────────────────────────────

function createTransporter() {
  const host = process.env.SMTP_HOST;
  const port = parseInt(process.env.SMTP_PORT || '587');
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  if (!host || !user || !pass) {
    throw new Error('Variables SMTP manquantes (SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS)');
  }

  return nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: { user, pass },
    pool: true,
    maxConnections: 3,
  });
}

// ─── HELPERS ──────────────────────────────────────────────────────────────────

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

/** Délai aléatoire entre BASE ± 50% pour éviter les patterns de spam */
function randomDelay(baseMs) {
  const jitter = baseMs * 0.5;
  return baseMs + (Math.random() * jitter * 2 - jitter);
}

/** Choisit un template en tournant (ou forcé) */
function pickTemplate(index) {
  if (FORCE_TEMPLATE !== null) return TEMPLATES[FORCE_TEMPLATE % TEMPLATES.length];
  return TEMPLATES[index % TEMPLATES.length];
}

async function apiFetch(path) {
  const res = await fetch(`${BASE_URL}${path}`, {
    headers: { 'x-user-id': USER_ID },
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data.data;
}

// ─── MAIN ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('─'.repeat(60));
  console.log('📬 AutoDemo — Envoi emails (version optimisée)');
  console.log(`   Base URL   : ${BASE_URL}`);
  console.log(`   Délai base : ${BASE_DELAY_MS}ms ± 50% (aléatoire)`);
  console.log(`   Templates  : ${FORCE_TEMPLATE !== null ? `forcé #${FORCE_TEMPLATE}` : 'rotation automatique'}`);
  console.log(`   Mode       : ${DRY_RUN ? '🔍 DRY RUN' : '📨 ENVOI RÉEL'}`);
  console.log('─'.repeat(60));

  // 1. Setup SMTP
  let transporter;
  if (!DRY_RUN) {
    try {
      transporter = createTransporter();
      await transporter.verify();
      console.log('\n✅ SMTP connecté');
    } catch (err) {
      console.error(`\n❌ SMTP échoué: ${err.message}`);
      process.exit(1);
    }
  }

  // 2. Récupération des sites
  console.log('\n🌐 Récupération des sites…');
  let sites;
  try {
    sites = await apiFetch('/sites');
  } catch (err) {
    console.error(`❌ ${err.message}`);
    process.exit(1);
  }

  let toEmail = sites.filter(s => s.lead_email && s.lead_email.includes('@'));
  if (FILTER_SITE_ID) toEmail = toEmail.filter(s => s.id === FILTER_SITE_ID);

  console.log(`   Sites totaux avec email : ${toEmail.length} / ${sites.length}`);

  if (toEmail.length === 0) {
    console.log('\n✅ Aucun email à envoyer.');
    return;
  }

  // 3. Envoi
  const SENDER = process.env.SMTP_SENDER_NAME || 'AutoDemo';
  const FROM   = process.env.SMTP_FROM || process.env.SMTP_USER;

  const stats = { sent: 0, failed: 0, skipped: 0 };
  const log   = { sent: [], failed: [] };

  console.log(`\n📨 Envoi vers ${toEmail.length} contacts…\n`);

  for (let i = 0; i < toEmail.length; i++) {
    const site     = toEmail[i];
    const to       = site.lead_email;
    const name     = site.lead_name || 'votre entreprise';
    const city     = site.city     || '';
    const activity = site.activity || site.lead_activity || '';

    const pad = `[${String(i + 1).padStart(3, ' ')}/${toEmail.length}]`;

    if (!to || !to.includes('@')) {
      console.log(`${pad} ⏭️  Email invalide — ignoré (${name})`);
      stats.skipped++;
      continue;
    }

    const buildFn = pickTemplate(i);
    const { subject, text, html } = buildFn({ name, city, activity, url: site.url, sender: SENDER });

    if (DRY_RUN) {
      console.log(`${pad} 🔍 [DRY] → ${to}`);
      console.log(`        Sujet    : ${subject}`);
      console.log(`        Template : #${i % TEMPLATES.length}`);
      console.log(`        URL      : ${site.url}`);
      stats.sent++;
      continue;
    }

    try {
      await transporter.sendMail({
        from:    `"${SENDER}" <${FROM}>`,
        to,
        subject,
        text,
        html,
      });

      const delay = Math.round(randomDelay(BASE_DELAY_MS));
      console.log(`${pad} ✅ Envoyé → ${to} (template #${i % TEMPLATES.length}, délai ${delay}ms)`);
      log.sent.push({ to, name, template: i % TEMPLATES.length });
      stats.sent++;

      if (i < toEmail.length - 1) await sleep(delay);
    } catch (err) {
      console.error(`${pad} ❌ Échec  → ${to} : ${err.message}`);
      log.failed.push({ to, name, error: err.message });
      stats.failed++;
    }
  }

  // 4. Résumé
  console.log('\n' + '─'.repeat(60));
  console.log('📊 Résumé final:');
  console.log(`   ✅ Envoyés  : ${stats.sent}`);
  console.log(`   ❌ Échoués  : ${stats.failed}`);
  console.log(`   ⏭️  Ignorés  : ${stats.skipped}`);

  if (log.failed.length > 0) {
    console.log('\n   Échecs détaillés:');
    log.failed.forEach(f => console.log(`   - ${f.to} (${f.name}) : ${f.error}`));
  }

  console.log('─'.repeat(60));
}

main().catch(err => {
  console.error('\n💥 Erreur fatale:', err.message);
  process.exit(1);
});
