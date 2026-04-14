/**
 * sendEmails.js — Envoie un email de prospection à chaque lead dont le site est généré.
 *
 * Prérequis:
 *   npm install nodemailer
 *
 * Variables d'environnement requises:
 *   SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM
 *
 * Usage:
 *   node scripts/sendEmails.js --userId <USER_ID>
 *   node scripts/sendEmails.js --userId <USER_ID> --dry-run
 *   node scripts/sendEmails.js --userId <USER_ID> --siteId <SITE_ID>
 */

import nodemailer from 'nodemailer';
import { parseArgs } from 'node:util';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ─── ARG PARSING ─────────────────────────────────────────────────────────────

const { values: args } = parseArgs({
  options: {
    userId:  { type: 'string' },
    baseUrl: { type: 'string', default: process.env.BASE_URL || 'http://localhost:3000' },
    siteId:  { type: 'string' },           // envoyer uniquement pour un site spécifique
    delay:   { type: 'string', default: '2000' }, // ms entre chaque email
    'dry-run': { type: 'boolean', default: false },
  },
  strict: false,
});

const USER_ID  = args.userId  || process.env.USER_ID;
const BASE_URL = args.baseUrl;
const DRY_RUN  = args['dry-run'];
const DELAY_MS = Math.max(0, parseInt(args.delay) || 2000);
const FILTER_SITE_ID = args.siteId;

if (!USER_ID) {
  console.error('❌  userId requis. Usage: node scripts/sendEmails.js --userId <ID>');
  process.exit(1);
}

// ─── SMTP SETUP ───────────────────────────────────────────────────────────────

function createTransporter() {
  const host = process.env.SMTP_HOST;
  const port = parseInt(process.env.SMTP_PORT || '587');
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  if (!host || !user || !pass) {
    throw new Error(
      'Variables SMTP manquantes. Définissez SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS dans votre .env'
    );
  }

  return nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: { user, pass },
  });
}

// ─── EMAIL TEMPLATE ───────────────────────────────────────────────────────────

function buildEmailHTML({ businessName, city, demoUrl, senderName }) {
  return `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Votre site est prêt</title>
  <style>
    body { margin:0; padding:0; background:#f4f4f7; font-family:Arial,sans-serif; }
    .wrapper { max-width:600px; margin:0 auto; padding:20px; }
    .card { background:#fff; border-radius:8px; overflow:hidden; box-shadow:0 2px 8px rgba(0,0,0,.08); }
    .header { background:linear-gradient(135deg,#6366f1,#8b5cf6); padding:32px 28px; text-align:center; }
    .header h1 { color:#fff; font-size:22px; margin:0 0 4px; }
    .header p  { color:rgba(255,255,255,.8); font-size:13px; margin:0; }
    .body      { padding:28px; }
    .body p    { color:#374151; font-size:14px; line-height:1.7; margin:0 0 14px; }
    .cta-block { text-align:center; margin:28px 0; }
    .cta-btn   { display:inline-block; background:#6366f1; color:#fff; text-decoration:none;
                 padding:14px 32px; border-radius:6px; font-weight:bold; font-size:15px; }
    .url-box   { background:#f9fafb; border:1px solid #e5e7eb; border-radius:6px;
                 padding:10px 14px; font-family:monospace; font-size:12px; color:#6b7280;
                 word-break:break-all; margin:12px 0; }
    .footer    { padding:20px 28px; border-top:1px solid #f0f0f0; }
    .footer p  { color:#9ca3af; font-size:12px; margin:0; line-height:1.6; }
  </style>
</head>
<body>
  <div class="wrapper">
    <div class="card">
      <div class="header">
        <h1>⚡ Votre site est prêt</h1>
        <p>Nous avons créé quelque chose pour vous</p>
      </div>
      <div class="body">
        <p>Bonjour,</p>
        <p>
          Nous avons créé une démonstration de site web pour <strong>${businessName}</strong>,
          spécialisé dans votre secteur à <strong>${city}</strong>.
        </p>
        <p>
          Ce site est conçu pour attirer vos clients locaux, mettre en valeur vos services
          et générer plus de contacts. Vous pouvez le consulter dès maintenant :
        </p>
        <div class="cta-block">
          <a href="${demoUrl}" class="cta-btn">🌐 Voir ma démo gratuite</a>
        </div>
        <div class="url-box">${demoUrl}</div>
        <p>
          Cette démonstration est personnalisée pour votre activité. Si vous souhaitez en discuter,
          n'hésitez pas à nous répondre directement à cet email.
        </p>
        <p>Bonne journée,<br /><strong>${senderName || 'L\'équipe AutoDemo'}</strong></p>
      </div>
      <div class="footer">
        <p>
          Vous recevez cet email car votre entreprise a été identifiée comme pouvant bénéficier
          d'une présence en ligne améliorée. Pour ne plus recevoir nos messages,
          <a href="mailto:${process.env.SMTP_FROM}?subject=Désabonnement">cliquez ici</a>.
        </p>
      </div>
    </div>
  </div>
</body>
</html>`;
}

function buildEmailText({ businessName, city, demoUrl, senderName }) {
  return `Bonjour,

Nous avons créé une démonstration de site web pour ${businessName}, spécialisé dans votre secteur à ${city}.

Consultez votre démo gratuite : ${demoUrl}

Ce site est personnalisé pour votre activité. Répondez à cet email pour en discuter.

Bonne journée,
${senderName || "L'équipe AutoDemo"}`;
}

// ─── API ──────────────────────────────────────────────────────────────────────

async function apiFetch(path) {
  const res = await fetch(`${BASE_URL}${path}`, {
    headers: { 'x-user-id': USER_ID },
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data.data;
}

// ─── SLEEP ────────────────────────────────────────────────────────────────────

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// ─── MAIN ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('─'.repeat(60));
  console.log('📬 AutoDemo — Envoi des emails de prospection');
  console.log(`   Base URL  : ${BASE_URL}`);
  console.log(`   User ID   : ${USER_ID}`);
  console.log(`   Délai     : ${DELAY_MS}ms entre chaque email`);
  console.log(`   Mode      : ${DRY_RUN ? '🔍 DRY RUN (aucun envoi)' : '📨 ENVOI RÉEL'}`);
  console.log('─'.repeat(60));

  // 1. Setup transporter (skip in dry-run)
  let transporter;
  if (!DRY_RUN) {
    try {
      transporter = createTransporter();
      await transporter.verify();
      console.log('\n✅ Connexion SMTP OK');
    } catch (err) {
      console.error(`\n❌ Connexion SMTP échouée: ${err.message}`);
      process.exit(1);
    }
  }

  // 2. Fetch sites
  console.log('\n🌐 Récupération des sites générés…');
  let sites;
  try {
    sites = await apiFetch('/sites');
  } catch (err) {
    console.error(`❌ Impossible de récupérer les sites: ${err.message}`);
    process.exit(1);
  }

  // 3. Filter
  let toEmail = sites.filter(s => s.lead_email); // only leads with email

  if (FILTER_SITE_ID) {
    toEmail = toEmail.filter(s => s.id === FILTER_SITE_ID);
  }

  console.log(`   Sites trouvés         : ${sites.length}`);
  console.log(`   Avec adresse email    : ${toEmail.length}`);

  if (toEmail.length === 0) {
    console.log('\n✅ Aucun email à envoyer. Fin du script.');
    console.log('   (Conseil: ajoutez le champ "email" à vos leads pour activer l\'envoi)');
    return;
  }

  // 4. Send emails
  const SENDER_NAME = process.env.SMTP_SENDER_NAME || 'AutoDemo';
  const FROM_EMAIL  = process.env.SMTP_FROM || process.env.SMTP_USER;
  const stats = { sent: 0, failed: 0, skipped: 0 };

  console.log(`\n📨 Envoi vers ${toEmail.length} contact(s)…\n`);

  for (const site of toEmail) {
    const to   = site.lead_email;
    const name = site.lead_name || 'Lead';
    const prefix = `   [${name.slice(0, 20).padEnd(20)}] <${to}>`;

    if (!to || !to.includes('@')) {
      console.log(`${prefix} ⏭️  Email invalide — ignoré`);
      stats.skipped++;
      continue;
    }

    if (DRY_RUN) {
      console.log(`${prefix} 🔍 [DRY RUN] Email qui serait envoyé`);
      console.log(`      Démo : ${site.url}`);
      stats.sent++;
      continue;
    }

    try {
      await transporter.sendMail({
        from:    `"${SENDER_NAME}" <${FROM_EMAIL}>`,
        to,
        subject: `${name} — Votre site démo est prêt à consulter`,
        text:    buildEmailText({ businessName: name, city: site.city || '', demoUrl: site.url, senderName: SENDER_NAME }),
        html:    buildEmailHTML({ businessName: name, city: site.city || '', demoUrl: site.url, senderName: SENDER_NAME }),
      });

      console.log(`${prefix} ✅ Envoyé`);
      stats.sent++;
    } catch (err) {
      console.log(`${prefix} ❌ ${err.message}`);
      stats.failed++;
    }

    if (DELAY_MS > 0) await sleep(DELAY_MS);
  }

  // 5. Summary
  console.log('\n' + '─'.repeat(60));
  console.log('📊 Résumé:');
  console.log(`   ✅ Envoyés : ${stats.sent}`);
  console.log(`   ❌ Échoués : ${stats.failed}`);
  console.log(`   ⏭️  Ignorés : ${stats.skipped}`);
  console.log('─'.repeat(60));
}

main().catch(err => {
  console.error('\n💥 Erreur fatale:', err.message);
  process.exit(1);
});
