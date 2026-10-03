/**
 * pipeline.js — Pipeline complet: import leads → génération sites → envoi emails
 *
 * Ce script orchestre tout le workflow en séquence :
 *   1. Importer/Vérifier des leads depuis un fichier JSON
 *   2. Générer les sites pour tous les leads "pending"
 *   3. Faire le point sur la prospection
 *
 * Les emails ne partent PAS d'ici : chaque génération inscrit le lead dans la
 * séquence du serveur (J0, J+3, J+7), seule propriétaire de l'outreach —
 * liste de désinscription, plafond, warmup, désinscription en un clic.
 * Ce script envoyait auparavant ses propres emails, sans aucun de ces
 * contrôles : à chaque exécution, tous les prospects (désinscrits compris)
 * recevaient un email en plus de celui de la séquence.
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
 *   --skip-email Sans effet (conservé pour compatibilité) : l'envoi relève du serveur
 *   --dry-run    Simuler sans rien écrire/envoyer
 *   --concurrency Nombre de générations en parallèle (défaut: 2)
 *   --baseUrl    URL de l'API (défaut: http://localhost:3000)
 */

import { readFileSync, existsSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { createApiClient } from './lib/apiClient.js';

// ─── ARG PARSING ─────────────────────────────────────────────────────────────

const { values: args } = parseArgs({
  options: {
    file:        { type: 'string' },
    'no-import': { type: 'boolean', default: false },
    'skip-email':{ type: 'boolean', default: false },
    'dry-run':   { type: 'boolean', default: false },
    concurrency: { type: 'string', default: '2' },
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
let apiFetchAll;
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

  // Toutes les pages : /leads est paginé (50 par défaut)
  let leads;
  try {
    leads = await apiFetchAll('/leads');
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

// ─── STEP 3: PROSPECTION ─────────────────────────────────────────────────────

/**
 * Point sur la prospection. Aucun envoi ici : la génération a inscrit chaque
 * lead joignable dans la séquence du serveur, qui envoie J0 puis les relances
 * en respectant désinscriptions, plafond d'envois et warmup.
 */
async function stepOutreach() {
  log.step(3, 'Prospection');

  if (SKIP_EMAIL) {
    log.warn('--skip-email est sans effet : l\'envoi est géré par la séquence du serveur.');
  }

  let leads;
  try {
    leads = await apiFetchAll('/leads');
  } catch (err) {
    log.error(`Impossible de récupérer les leads: ${err.message}`);
    return { reachable: 0, total: 0 };
  }

  const withSite  = leads.filter(l => l.status === 'done');
  const reachable = withSite.filter(l => l.email && l.email.includes('@')).length;
  log.info(`Prospects avec site et email : ${reachable} / ${withSite.length}`);
  log.info('Envoi pris en charge par la séquence du serveur (J0, J+3, J+7) si SMTP y est configuré.');
  log.info('Suivi : onglet Analytics du dashboard.');
  return { reachable, total: withSite.length };
}

// ─── MAIN ─────────────────────────────────────────────────────────────────────

async function main() {
  ({ apiFetch, apiFetchAll, userId } = await createApiClient({ baseUrl: BASE_URL }));

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
  const outreachStats = await stepOutreach();

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
  console.log(`\n   Étape 3 — Prospection (séquence du serveur):`);
  console.log(`     Joignables par email : ${outreachStats.reachable} / ${outreachStats.total}`);
  console.log(`\n   ⏱️  Durée totale: ${duration}s`);
  console.log('═'.repeat(60));

  if (generateStats.failed > 0) {
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
