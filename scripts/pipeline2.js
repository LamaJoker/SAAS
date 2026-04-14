#!/usr/bin/env node
/**
 * pipeline2.js — Pipeline scalable avec queue SQLite
 *
 * Usage:
 *   node scripts/pipeline2.js --userId <ID> --file ./data/leads.json
 *   node scripts/pipeline2.js --userId <ID> --file ./data/leads.json --skip-email
 *   node scripts/pipeline2.js --userId <ID> --no-import --skip-email
 *   node scripts/pipeline2.js --userId <ID> --dry-run
 *   node scripts/pipeline2.js --userId <ID> --file ./data/leads.json --continuous
 *
 * Options:
 *   --userId       (requis) ID utilisateur
 *   --file         Fichier JSON de leads à importer
 *   --no-import    Sauter l'import (utiliser leads existants)
 *   --skip-email   Ne pas envoyer les emails
 *   --dry-run      Simuler sans écrire ni envoyer
 *   --continuous   Tourner en boucle jusqu'à Ctrl-C
 *   --concurrency  Générations en parallèle (défaut: GEN_CONCURRENCY ou 3)
 *   --watch-ms     Intervalle de boucle en mode --continuous (défaut: 60000)
 *   --baseUrl      URL du serveur (défaut: BASE_URL ou http://localhost:3000)
 */

import { readFileSync, existsSync } from 'node:fs';
import { parseArgs }                from 'node:util';
import { fileURLToPath }            from 'node:url';
import { dirname, resolve }         from 'node:path';
import dotenv                       from 'dotenv';

dotenv.config();

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── Arg parsing ───────────────────────────────────────────────────────────────

const { values: args } = parseArgs({
  options: {
    userId:       { type: 'string' },
    file:         { type: 'string' },
    'no-import':  { type: 'boolean', default: false },
    'skip-email': { type: 'boolean', default: false },
    'dry-run':    { type: 'boolean', default: false },
    continuous:   { type: 'boolean', default: false },
    concurrency:  { type: 'string',  default: process.env.GEN_CONCURRENCY ?? '3' },
    'watch-ms':   { type: 'string',  default: '60000' },
    baseUrl:      { type: 'string',  default: process.env.BASE_URL ?? 'http://localhost:3000' },
  },
  strict: false,
});

const USER_ID    = args.userId ?? process.env.USER_ID;
const LEADS_FILE = args.file;
const NO_IMPORT  = args['no-import'];
const SKIP_EMAIL = args['skip-email'];
const DRY_RUN    = args['dry-run'];
const CONTINUOUS = args.continuous;
const WATCH_MS   = Math.max(5_000, parseInt(args['watch-ms'] ?? '60000'));
const BASE_URL   = args.baseUrl;

if (!USER_ID) {
  console.error('❌  --userId requis');
  process.exit(1);
}

// Override env concurrency if passed via flag
process.env.GEN_CONCURRENCY = args.concurrency;

// ── Imports (after env is ready) ──────────────────────────────────────────────

const { scrapeQueue, generateQueue, emailQueue,
        startScrapeWorker, startGenerateWorker, startEmailWorker,
        stopAllWorkers }  = await import('../src/workers/index.js');
const { Lead }            = await import('../src/db/models/Lead.js');
const { logger }          = await import('../src/utils/logger.js');
const { sleep }           = await import('../src/utils/utils.js');
const { runMigrations }   = await import('../src/db/database.js');

// ── Helpers ───────────────────────────────────────────────────────────────────

function banner(text) {
  const line = '═'.repeat(60);
  console.log(`\n${line}\n  ${text}\n${line}`);
}

function step(n, text) {
  console.log(`\n${'─'.repeat(60)}\n  ÉTAPE ${n}: ${text.toUpperCase()}\n${'─'.repeat(60)}`);
}

async function waitForQueueEmpty(queue, label, timeoutMs = 120_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const stats = queue.getStats();
    const active = (stats.pending ?? 0) + (stats.processing ?? 0) + (stats.retrying ?? 0);
    if (active === 0) return;
    logger.debug(`[Pipeline] Waiting for ${label}`, stats);
    await sleep(1_000);
  }
  logger.warn(`[Pipeline] Timeout waiting for ${label} queue to drain`);
}

// ── Step 1: Import leads ──────────────────────────────────────────────────────

async function stepImport() {
  step(1, 'Import des leads');

  if (NO_IMPORT) {
    console.log('  ⏭️  Import ignoré (--no-import)');
    return { enqueued: 0 };
  }

  if (!LEADS_FILE) {
    console.log('  ⏭️  Aucun fichier --file fourni. Utilisation des leads existants.');
    return { enqueued: 0 };
  }

  if (!existsSync(LEADS_FILE)) {
    console.error(`❌  Fichier introuvable: ${LEADS_FILE}`);
    process.exit(1);
  }

  let leads;
  try {
    leads = JSON.parse(readFileSync(LEADS_FILE, 'utf-8'));
    if (!Array.isArray(leads)) throw new Error('Le JSON doit être un tableau');
  } catch (err) {
    console.error(`❌  JSON invalide: ${err.message}`);
    process.exit(1);
  }

  console.log(`  ℹ️  ${leads.length} lead(s) dans le fichier`);

  if (DRY_RUN) {
    leads.slice(0, 5).forEach((l, i) => console.log(`    ${i + 1}. ${l.name} — ${l.city}`));
    if (leads.length > 5) console.log(`    … et ${leads.length - 5} autres`);
    return { enqueued: leads.length };
  }

  let enqueued = 0;
  for (const lead of leads) {
    scrapeQueue.add(
      { ...lead, userId: USER_ID, autoGenerate: !SKIP_EMAIL },
      { id: `scrape-${USER_ID}-${lead.name}-${lead.city}`.replace(/\s+/g, '-').toLowerCase().slice(0, 64) },
    );
    enqueued++;
  }

  console.log(`  ✅ ${enqueued} job(s) enqueués dans scrapeQueue`);
  return { enqueued };
}

// ── Step 2: Run workers ───────────────────────────────────────────────────────

async function stepRunWorkers() {
  step(2, 'Démarrage des workers');

  startScrapeWorker();
  startGenerateWorker();
  if (!SKIP_EMAIL) startEmailWorker();

  console.log(`  ✅ Workers démarrés`);
  console.log(`     scrape   : concurrence 5`);
  console.log(`     generate : concurrence ${process.env.GEN_CONCURRENCY}`);
  if (!SKIP_EMAIL) console.log(`     email    : concurrence 2`);
}

// ── Step 3: Enqueue pending leads (for --no-import runs) ──────────────────────

async function stepEnqueuePending() {
  step(3, 'Enqueue leads existants (status=pending)');

  const pending = Lead.findAllByUser(USER_ID).filter(l => l.status === 'pending');
  console.log(`  ℹ️  ${pending.length} lead(s) pending trouvé(s)`);

  if (DRY_RUN) {
    pending.forEach((l, i) => console.log(`    ${i + 1}. ${l.name} (${l.city})`));
    return { enqueued: pending.length };
  }

  let enqueued = 0;
  for (const lead of pending) {
    generateQueue.add(
      { leadId: lead.id, userId: USER_ID },
      { id: `gen-${lead.id}` },
    );
    enqueued++;
  }

  console.log(`  ✅ ${enqueued} job(s) enqueués dans generateQueue`);
  return { enqueued };
}

// ── Step 4: Wait for completion ───────────────────────────────────────────────

async function stepWaitCompletion() {
  step(4, 'Attente de fin de traitement');

  console.log('  ⏳ Attente scrapeQueue…');
  await waitForQueueEmpty(scrapeQueue, 'scrape');

  console.log('  ⏳ Attente generateQueue…');
  await waitForQueueEmpty(generateQueue, 'generate', 300_000); // 5 min

  if (!SKIP_EMAIL) {
    console.log('  ⏳ Attente emailQueue…');
    await waitForQueueEmpty(emailQueue, 'email', 120_000);
  }

  console.log('  ✅ Traitement terminé');
}

// ── Step 5: Print stats ───────────────────────────────────────────────────────

function printStats() {
  step(5, 'Statistiques finales');
  const queues = [
    ['scrape',   scrapeQueue.getStats()],
    ['generate', generateQueue.getStats()],
    ['email',    emailQueue.getStats()],
  ];

  for (const [name, s] of queues) {
    console.log(`\n  Queue: ${name}`);
    console.log(`    ✅ done       : ${s.done       ?? 0}`);
    console.log(`    ⏳ pending    : ${s.pending    ?? 0}`);
    console.log(`    🔄 processing : ${s.processing ?? 0}`);
    console.log(`    🔁 retrying   : ${s.retrying   ?? 0}`);
    console.log(`    ❌ error      : ${s.error      ?? 0}`);
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function runOnce() {
  const { enqueued: imported } = await stepImport();

  // If we didn't import anything via file, enqueue pending leads from DB
  if (!imported && (NO_IMPORT || !LEADS_FILE)) {
    await stepEnqueuePending();
  }

  await stepWaitCompletion();
  printStats();
}

async function main() {
  banner(`AutoDemo — Pipeline Scalable${DRY_RUN ? ' [DRY RUN]' : ''}${CONTINUOUS ? ' [CONTINUOUS]' : ''}`);
  console.log(`  User ID     : ${USER_ID}`);
  console.log(`  Fichier     : ${LEADS_FILE ?? 'aucun'}`);
  console.log(`  Concurrence : ${process.env.GEN_CONCURRENCY}`);
  console.log(`  Skip email  : ${SKIP_EMAIL}`);
  if (CONTINUOUS) console.log(`  Watch ms    : ${WATCH_MS}`);

  // Run DB migrations to ensure jobs table exists
  runMigrations();

  if (!DRY_RUN) {
    await stepRunWorkers();
  }

  // ── Continuous mode ──────────────────────────────────────────────────────

  if (CONTINUOUS) {
    console.log(`\n  🔁 Mode continu — Ctrl-C pour arrêter\n`);

    const stop = async () => {
      console.log('\n\n  🛑 Arrêt demandé…');
      await stopAllWorkers();
      printStats();
      process.exit(0);
    };

    process.on('SIGINT',  stop);
    process.on('SIGTERM', stop);

    // First run immediately
    await runOnce();

    // Then poll for new pending leads
    while (true) {
      await sleep(WATCH_MS);
      logger.info('[Pipeline] Continuous tick — checking for new leads');
      await stepEnqueuePending();
      await stepWaitCompletion();
    }
  }

  // ── One-shot mode ────────────────────────────────────────────────────────

  await runOnce();

  if (!DRY_RUN) {
    await stopAllWorkers();
  }
}

main().catch(err => {
  console.error('\n💥 Erreur fatale:', err.message);
  console.error(err.stack);
  process.exit(1);
});
