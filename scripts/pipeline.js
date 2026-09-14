/**
 * pipeline.js — Pipeline complet: import leads → génération sites → envoi emails
 *
 * Ce script orchestre tout le workflow en séquence :
 *   1. Importer/Vérifier des leads depuis un fichier JSON
 *   2. Générer les sites pour tous les leads "pending"
 *   3. Envoyer les emails de prospection aux leads avec email
 *
 * Usage:
 *   node scripts/pipeline.js --file ./data/leads.json
 *   node scripts/pipeline.js --file ./data/leads.json --skip-email
 *   node scripts/pipeline.js --no-import --skip-email
 *   node scripts/pipeline.js --dry-run
 *
 * Options:
 *   (identité : SCRIPT_EMAIL / SCRIPT_PASSWORD dans .env)
 *   --file       Fichier JSON de leads à importer (optionnel si leads déjà en base)
 *   --no-import  Sauter l'étape d'import (utiliser les leads existants)
 *   --skip-email Ne pas envoyer les emails
 *   --dry-run    Simuler sans rien écrire/envoyer
 *   --concurrency Nombre de générations en parallèle (défaut: 2)
 *   --delay      Délai entre emails en ms (défaut: 2000)
 *   --baseUrl    URL de l'API (défaut: http://localhost:3000)
 */

import { readFileSync, existsSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { createApiClient } from './lib/apiClient.js';
import nodemailer from 'nodemailer';

// ─── ARG PARSING ─────────────────────────────────────────────────────────────

const { values: args } = parseArgs({
  options: {
    file:        { type: 'string' },
    'no-import': { type: 'boolean', default: false },
    'skip-email':{ type: 'boolean', default: false },
    'dry-run':   { type: 'boolean', default: false },
    concurrency: { type: 'string', default: '2' },
    delay:       { type: 'string', default: '2000' },
    baseUrl:     { type: 'string', default: process.env.BASE_URL || 'http://localhost:3000' },
  },
  strict: false,
});

const BASE_URL    = args.baseUrl;
const LEADS_FILE  = args.file;
const NO_IMPORT   = args['no-import'];
const SKIP_EMAIL  = args['skip-email'];
const DRY_RUN     = args['dry-run'];
const CONCURRENCY = Math.max(1, parseInt(args.concurrency) || 2);
const EMAIL_DELAY = Math.max(0, parseInt(args.delay) || 2000);

// ─── LOGGER ───────────────────────────────────────────────────────────────────

const log = {
  info:    (...a) => console.log('  ℹ️ ', ...a),
  success: (...a) => console.log('  ✅', ...a),
  warn:    (...a) => console.log('  ⚠️ ', ...a),
  error:   (...a) => console.error('  ❌', ...a),
  step:    (n, t) => { console.log(); console.log(`${'━'.repeat(60)}\n  ÉTAPE ${n}: ${t.toUpperCase()}\n${'━'.repeat(60)}`); },
};

// ─── API HELPERS ──────────────────────────────────────────────────────────────

// Client authentifié (login → Bearer), initialisé au démarrage de main().
// L'en-tête x-user-id n'est plus lu par l'API depuis la migration JWT.
let apiFetch;
let userId;

// ─── CONCURRENCY POOL ─────────────────────────────────────────────────────────

async function pool(items, limit, fn) {
  const results = [];
  const queue   = [...items];

  async function worker() {
    while (queue.length > 0) {
      const item = queue.shift();
      results.push(await fn(item).catch(err => ({ __error: err.message, item })));
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// ─── STEP 1: IMPORT LEADS ────────────────────────────────────────────────────

async function stepImport() {
  log.step(1, 'Import des leads');

  if (NO_IMPORT) {
    log.info('Import ignoré (--no-import)');
    return { imported: 0, skipped: 0, errors: 0 };
  }

  if (!LEADS_FILE) {
    log.warn('Aucun fichier spécifié (--file). Import ignoré.');
    log.info('Les leads existants en base seront utilisés.');
    return { imported: 0, skipped: 0, errors: 0 };
  }

  if (!existsSync(LEADS_FILE)) {
    log.error(`Fichier introuvable: ${LEADS_FILE}`);
    process.exit(1);
  }

  let leads;
  try {
    const raw = readFileSync(LEADS_FILE, 'utf-8');
    leads = JSON.parse(raw);
    if (!Array.isArray(leads)) throw new Error('Le JSON doit être un tableau.');
  } catch (err) {
    log.error(`Fichier invalide: ${err.message}`);
    process.exit(1);
  }

  log.info(`${leads.length} lead(s) dans le fichier`);

  if (DRY_RUN) {
    log.info('[DRY RUN] Leads qui seraient importés:');
    leads.slice(0, 5).forEach((l, i) => log.info(`  ${i + 1}. ${l.name} — ${l.city}`));
    if (leads.length > 5) log.info(`  … et ${leads.length - 5} autres`);
    return { imported: leads.length, skipped: 0, errors: 0 };
  }

  const stats = { imported: 0, skipped: 0, errors: 0 };

  for (const lead of leads) {
    try {
      await apiFetch('/leads', { method: 'POST', body: JSON.stringify(lead) });
      log.success(`Importé: ${lead.name} (${lead.city})`);
      stats.imported++;
    } catch (err) {
      if (err.message.includes('409') || err.message.toLowerCase().includes('conflict')) {
        log.info(`Ignoré (déjà existant): ${lead.name}`);
        stats.skipped++;
      } else {
        log.error(`Erreur pour "${lead.name}": ${err.message}`);
        stats.errors++;
      }
    }
  }

  log.info(`Import terminé — ${stats.imported} ajoutés, ${stats.skipped} ignorés, ${stats.errors} erreurs`);
  return stats;
}

// ─── STEP 2: GENERATE SITES ──────────────────────────────────────────────────

async function stepGenerate() {
  log.step(2, 'Génération des sites');

  // Fetch pending leads
  let leads;
  try {
    leads = await apiFetch('/leads');
  } catch (err) {
    log.error(`Impossible de récupérer les leads: ${err.message}`);
    process.exit(1);
  }

  const pending = leads.filter(l => l.status === 'pending');
  log.info(`Leads en attente de génération: ${pending.length} / ${leads.length}`);

  if (pending.length === 0) {
    log.info('Aucun lead à générer.');
    return { success: 0, failed: 0 };
  }

  // Check credits
  try {
    const { credits } = await apiFetch('/sites/credits');
    log.info(`Crédits disponibles: ${credits}`);
    if (credits < pending.length) {
      log.warn(`Crédits insuffisants (${credits}) pour ${pending.length} leads. Traitement partiel.`);
    }
  } catch { /* non bloquant */ }

  if (DRY_RUN) {
    log.info('[DRY RUN] Sites qui seraient générés:');
    pending.forEach((l, i) => log.info(`  ${i + 1}. ${l.name} (${l.city})`));
    return { success: pending.length, failed: 0 };
  }

  const stats = { success: 0, failed: 0 };

  await pool(pending, CONCURRENCY, async (lead) => {
    try {
      const site = await apiFetch('/generate', {
        method: 'POST',
        body: JSON.stringify({ leadId: lead.id }),
      });
      log.success(`Généré: ${lead.name} → ${site.url}`);
      stats.success++;
    } catch (err) {
      log.error(`Échec pour "${lead.name}": ${err.message}`);
      stats.failed++;
    }
  });

  log.info(`Génération terminée — ${stats.success} réussis, ${stats.failed} échecs`);
  return stats;
}

// ─── STEP 3: SEND EMAILS ─────────────────────────────────────────────────────

async function stepSendEmails() {
  log.step(3, 'Envoi des emails de prospection');

  if (SKIP_EMAIL) {
    log.info('Envoi d\'emails ignoré (--skip-email)');
    return { sent: 0, skipped: 0, failed: 0 };
  }

  // Setup SMTP
  let transporter;
  if (!DRY_RUN) {
    const host = process.env.SMTP_HOST;
    const user = process.env.SMTP_USER;
    const pass = process.env.SMTP_PASS;

    if (!host || !user || !pass) {
      log.warn('Variables SMTP manquantes (SMTP_HOST, SMTP_USER, SMTP_PASS).');
      log.warn('Envoi des emails ignoré. Configurez votre .env pour activer cette étape.');
      return { sent: 0, skipped: 0, failed: 0 };
    }

    try {
      transporter = nodemailer.createTransport({
        host,
        port: parseInt(process.env.SMTP_PORT || '587'),
        secure: process.env.SMTP_PORT === '465',
        auth: { user, pass },
      });
      await transporter.verify();
      log.success('Connexion SMTP OK');
    } catch (err) {
      log.error(`Connexion SMTP échouée: ${err.message}`);
      log.warn('Envoi des emails ignoré.');
      return { sent: 0, skipped: 0, failed: 0 };
    }
  }

  // Fetch sites
  let sites;
  try {
    sites = await apiFetch('/sites');
  } catch (err) {
    log.error(`Impossible de récupérer les sites: ${err.message}`);
    return { sent: 0, skipped: 0, failed: 0 };
  }

  const withEmail = sites.filter(s => s.lead_email && s.lead_email.includes('@'));
  log.info(`Sites avec adresse email: ${withEmail.length} / ${sites.length}`);

  if (withEmail.length === 0) {
    log.warn('Aucun lead avec email. Ajoutez le champ "email" lors de l\'import.');
    return { sent: 0, skipped: 0, failed: 0 };
  }

  const FROM   = process.env.SMTP_FROM  || process.env.SMTP_USER;
  const SENDER = process.env.SMTP_SENDER_NAME || 'AutoDemo';
  const stats  = { sent: 0, skipped: 0, failed: 0 };

  for (const site of withEmail) {
    const name = site.lead_name || 'Votre entreprise';
    const city = site.city || '';

    if (DRY_RUN) {
      log.info(`[DRY RUN] Email → ${site.lead_email} | ${name} | ${site.url}`);
      stats.sent++;
      continue;
    }

    try {
      await transporter.sendMail({
        from:    `"${SENDER}" <${FROM}>`,
        to:      site.lead_email,
        subject: `${name} — Votre site démo est prêt`,
        text:    `Bonjour,\n\nVotre démo est disponible : ${site.url}\n\nBonne journée,\n${SENDER}`,
        html:    buildProspectEmail({ name, city, url: site.url, sender: SENDER }),
      });
      log.success(`Email envoyé → ${site.lead_email}`);
      stats.sent++;
    } catch (err) {
      log.error(`Échec envoi → ${site.lead_email}: ${err.message}`);
      stats.failed++;
    }

    if (EMAIL_DELAY > 0) await sleep(EMAIL_DELAY);
  }

  log.info(`Emails terminés — ${stats.sent} envoyés, ${stats.failed} échoués, ${stats.skipped} ignorés`);
  return stats;
}

// ─── EMAIL TEMPLATE ───────────────────────────────────────────────────────────

function buildProspectEmail({ name, city, url, sender }) {
  return `<!DOCTYPE html>
<html lang="fr"><head><meta charset="UTF-8">
<style>
  body{margin:0;padding:0;background:#f4f4f7;font-family:Arial,sans-serif}
  .wrap{max-width:580px;margin:0 auto;padding:20px}
  .card{background:#fff;border-radius:8px;box-shadow:0 2px 8px rgba(0,0,0,.08)}
  .head{background:linear-gradient(135deg,#6366f1,#8b5cf6);padding:28px;text-align:center;border-radius:8px 8px 0 0}
  .head h1{color:#fff;font-size:20px;margin:0}
  .body{padding:28px;color:#374151;font-size:14px;line-height:1.7}
  .cta{text-align:center;margin:24px 0}
  .cta a{background:#6366f1;color:#fff;text-decoration:none;padding:13px 30px;border-radius:6px;font-weight:bold}
  .foot{padding:16px 28px;border-top:1px solid #f0f0f0;font-size:12px;color:#9ca3af}
</style>
</head><body><div class="wrap"><div class="card">
<div class="head"><h1>⚡ Votre site démo est prêt</h1></div>
<div class="body">
  <p>Bonjour,</p>
  <p>Nous avons créé une démo personnalisée pour <strong>${name}</strong>${city ? ` à ${city}` : ''}.</p>
  <p>Ce site est optimisé pour convertir vos prospects locaux en clients.</p>
  <div class="cta"><a href="${url}">🌐 Voir ma démo gratuite</a></div>
  <p>Répondez à cet email pour en discuter.</p>
  <p>Bonne journée,<br><strong>${sender}</strong></p>
</div>
<div class="foot">Pour ne plus recevoir nos emails, répondez avec "Désinscription".</div>
</div></div></body></html>`;
}

// ─── MAIN ─────────────────────────────────────────────────────────────────────

async function main() {
  ({ apiFetch, userId } = await createApiClient({ baseUrl: BASE_URL }));

  const startTime = Date.now();

  console.log('═'.repeat(60));
  console.log('🚀 AutoDemo — Pipeline complet');
  console.log(`   Base URL    : ${BASE_URL}`);
  console.log(`   Compte      : ${userId}`);
  console.log(`   Fichier     : ${LEADS_FILE || 'aucun'}`);
  console.log(`   Concurrence : ${CONCURRENCY}`);
  console.log(`   Mode        : ${DRY_RUN ? '🔍 DRY RUN' : '⚡ PRODUCTION'}`);
  console.log('═'.repeat(60));

  // Run pipeline
  const importStats   = await stepImport();
  const generateStats = await stepGenerate();
  const emailStats    = await stepSendEmails();

  // Final summary
  const duration = ((Date.now() - startTime) / 1000).toFixed(1);

  console.log('\n' + '═'.repeat(60));
  console.log('📊 RÉSUMÉ DU PIPELINE');
  console.log('═'.repeat(60));
  console.log(`\n   Étape 1 — Import:`);
  console.log(`     Importés : ${importStats.imported}`);
  console.log(`     Ignorés  : ${importStats.skipped}`);
  console.log(`     Erreurs  : ${importStats.errors}`);
  console.log(`\n   Étape 2 — Génération:`);
  console.log(`     Réussis  : ${generateStats.success}`);
  console.log(`     Échoués  : ${generateStats.failed}`);
  console.log(`\n   Étape 3 — Emails:`);
  console.log(`     Envoyés  : ${emailStats.sent}`);
  console.log(`     Échoués  : ${emailStats.failed}`);
  console.log(`     Ignorés  : ${emailStats.skipped}`);
  console.log(`\n   ⏱️  Durée totale: ${duration}s`);
  console.log('═'.repeat(60));

  if (generateStats.failed > 0 || emailStats.failed > 0) {
    console.log('\n⚠️  Des erreurs sont survenues. Vérifiez les logs ci-dessus.\n');
  } else {
    console.log('\n✅ Pipeline terminé avec succès.\n');
  }
}

main().catch(err => {
  console.error('\n💥 Erreur fatale:', err.message);
  console.error(err.stack);
  process.exit(1);
});
