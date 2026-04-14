/**
 * generateBulk.js — Génération en masse avec skip des leads déjà traités,
 * concurrence limitée et logs propres.
 *
 * Usage:
 *   node scripts/generateBulk.js --userId <USER_ID>
 *   node scripts/generateBulk.js --userId <USER_ID> --concurrency 3
 *   node scripts/generateBulk.js --userId <USER_ID> --status all
 *   node scripts/generateBulk.js --userId <USER_ID> --dry-run
 */

import { parseArgs } from 'node:util';

// ─── CONFIG ──────────────────────────────────────────────────────────────────

const { values: args } = parseArgs({
  options: {
    userId:      { type: 'string' },
    baseUrl:     { type: 'string', default: process.env.BASE_URL || 'http://localhost:3000' },
    concurrency: { type: 'string', default: process.env.GEN_CONCURRENCY || '2' },
    'dry-run':   { type: 'boolean', default: false },
    status:      { type: 'string', default: 'pending' },
    retry:       { type: 'string', default: '2' },
    delay:       { type: 'string', default: '500' }, // ms entre requêtes
  },
  strict: false,
});

const USER_ID     = args.userId  || process.env.USER_ID;
const BASE_URL    = args.baseUrl;
const CONCURRENCY = Math.min(5, Math.max(1, parseInt(args.concurrency) || 2)); // cap à 5
const DRY_RUN     = args['dry-run'];
const STATUS      = args.status;   // 'pending' | 'error' | 'all'
const MAX_RETRY   = Math.max(1, parseInt(args.retry) || 2);
const REQ_DELAY   = Math.max(0, parseInt(args.delay) || 500);

if (!USER_ID) {
  console.error('❌  userId requis. Usage: node scripts/generateBulk.js --userId <ID>');
  process.exit(1);
}

// ─── HELPERS ─────────────────────────────────────────────────────────────────

const sleep   = (ms) => new Promise(r => setTimeout(r, ms));
const ts      = ()   => new Date().toLocaleTimeString('fr-FR');
const pad     = (i, total) => `[${String(i).padStart(String(total).length, ' ')}/${total}]`;

async function apiFetch(path, options = {}) {
  const res = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'x-user-id':    USER_ID,
      ...(options.headers || {}),
    },
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data.data;
}

async function withRetry(fn, attempts = MAX_RETRY, delayMs = 1500) {
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (i < attempts - 1) {
        console.log(`[${ts()}] ⚠️  Retry ${i + 1}/${attempts}: ${err.message}`);
        await sleep(delayMs * (i + 1)); // backoff linéaire
      }
    }
  }
  throw lastErr;
}

// ─── POOL DE CONCURRENCE ──────────────────────────────────────────────────────

async function pool(items, limit, fn) {
  const queue   = [...items.entries()]; // [index, item]
  const results = new Array(items.length);

  async function worker() {
    while (queue.length > 0) {
      const [i, item] = queue.shift();
      results[i] = await fn(item, i).catch(err => ({ __error: err.message }));
      if (REQ_DELAY > 0) await sleep(REQ_DELAY);
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

// ─── MAIN ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('─'.repeat(60));
  console.log(`[${ts()}] ⚡ AutoDemo — Génération en masse`);
  console.log(`  URL         : ${BASE_URL}`);
  console.log(`  User        : ${USER_ID}`);
  console.log(`  Concurrence : ${CONCURRENCY} (max 5)`);
  console.log(`  Filtre      : statut="${STATUS}"`);
  console.log(`  Retry       : ${MAX_RETRY} tentatives`);
  console.log(`  Mode        : ${DRY_RUN ? '🔍 DRY RUN' : '⚡ PRODUCTION'}`);
  console.log('─'.repeat(60));

  // 1. Récupération des leads
  console.log(`\n[${ts()}] 📋 Récupération des leads…`);
  let leads;
  try {
    leads = await apiFetch('/leads');
  } catch (err) {
    console.error(`❌ Impossible de récupérer les leads: ${err.message}`);
    process.exit(1);
  }

  // 2. Filtrage
  const statusFilter = STATUS === 'all'
    ? () => true
    : STATUS === 'error'
      ? (l) => l.status === 'error' || l.status === 'pending'
      : (l) => l.status === 'pending';

  const toProcess = leads.filter(statusFilter);

  console.log(`  Total       : ${leads.length} leads`);
  console.log(`  À traiter   : ${toProcess.length} (filtre: ${STATUS})`);
  console.log(`  Ignorés     : ${leads.filter(l => l.status === 'done').length} déjà générés`);

  if (toProcess.length === 0) {
    console.log(`\n✅ Aucun lead à traiter. Fin.`);
    return;
  }

  // 3. Vérification crédits
  try {
    const { credits } = await apiFetch('/sites/credits');
    console.log(`\n  💳 Crédits : ${credits} disponible(s)`);
    if (credits <= 0) {
      console.error('❌ Aucun crédit disponible. Arrêt.');
      process.exit(1);
    }
    if (credits < toProcess.length) {
      console.log(`  ⚠️  Traitement partiel (crédits insuffisants pour tout)`);
    }
  } catch {
    console.log(`  ⚠️  Crédits non vérifiables (non bloquant)`);
  }

  if (DRY_RUN) {
    console.log('\n🔍 Mode DRY RUN — leads qui seraient générés:');
    toProcess.forEach((l, i) => console.log(`  ${pad(i + 1, toProcess.length)} ${l.name} (${l.city}) [${l.status}]`));
    return;
  }

  // 4. Génération avec pool
  console.log(`\n[${ts()}] ⚡ Démarrage (${CONCURRENCY} en parallèle)…\n`);

  const stats = { success: 0, failed: 0, skipped: 0 };
  const errors = [];

  await pool(toProcess, CONCURRENCY, async (lead, i) => {
    const label = `${pad(i + 1, toProcess.length)} ${lead.name.slice(0, 28).padEnd(28)} [${lead.city}]`;

    // Skip si déjà généré (double-check en temps réel)
    if (lead.status === 'done') {
      console.log(`${label} ⏭️  Déjà généré`);
      stats.skipped++;
      return;
    }

    try {
      const site = await withRetry(() => apiFetch('/generate', {
        method: 'POST',
        body:   JSON.stringify({ leadId: lead.id }),
      }));
      console.log(`[${ts()}] ${label} ✅ ${site.url}`);
      stats.success++;
    } catch (err) {
      console.log(`[${ts()}] ${label} ❌ ${err.message}`);
      stats.failed++;
      errors.push({ name: lead.name, error: err.message });
    }
  });

  // 5. Résumé
  console.log('\n' + '─'.repeat(60));
  console.log(`[${ts()}] 📊 Résumé:`);
  console.log(`  ✅ Réussis  : ${stats.success}`);
  console.log(`  ❌ Échoués  : ${stats.failed}`);
  console.log(`  ⏭️  Ignorés  : ${stats.skipped}`);

  if (errors.length > 0) {
    console.log('\n  Détail des échecs:');
    errors.forEach(e => console.log(`  - ${e.name}: ${e.error}`));
  }

  console.log('─'.repeat(60) + '\n');

  process.exit(stats.failed > 0 ? 1 : 0);
}

main().catch(err => {
  console.error('\n💥 Erreur fatale:', err.message);
  process.exit(1);
});
