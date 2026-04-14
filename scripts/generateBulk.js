/**
 * generateBulk.js — Génère automatiquement les sites pour tous les leads "pending".
 *
 * Usage:
 *   node scripts/generateBulk.js --userId <USER_ID>
 *   node scripts/generateBulk.js --userId <USER_ID> --concurrency 2
 *   node scripts/generateBulk.js --userId <USER_ID> --dry-run
 */

import fetch from 'node:http';
import { parseArgs } from 'node:util';

// ─── CONFIG ──────────────────────────────────────────────────────────────────

const DEFAULT_BASE_URL   = process.env.BASE_URL    || 'http://localhost:3000';
const DEFAULT_CONCURRENCY = parseInt(process.env.GEN_CONCURRENCY || '2');

// ─── ARG PARSING ─────────────────────────────────────────────────────────────

const { values: args } = parseArgs({
  options: {
    userId:      { type: 'string' },
    baseUrl:     { type: 'string', default: DEFAULT_BASE_URL },
    concurrency: { type: 'string', default: String(DEFAULT_CONCURRENCY) },
    'dry-run':   { type: 'boolean', default: false },
    status:      { type: 'string', default: 'pending' }, // filter: pending | all
  },
  strict: false,
});

const USER_ID    = args.userId    || process.env.USER_ID;
const BASE_URL   = args.baseUrl;
const CONCURRENCY = Math.max(1, parseInt(args.concurrency) || DEFAULT_CONCURRENCY);
const DRY_RUN    = args['dry-run'];
const STATUS_FILTER = args.status;

if (!USER_ID) {
  console.error('❌  userId requis. Usage: node scripts/generateBulk.js --userId <ID>');
  process.exit(1);
}

// ─── HTTP HELPERS ─────────────────────────────────────────────────────────────

function httpRequest(url, options = {}) {
  return new Promise((resolve, reject) => {
    const urlObj   = new URL(url);
    const lib      = urlObj.protocol === 'https:' ? (await import('node:https')).default : (await import('node:http')).default;
    const reqOpts  = {
      hostname: urlObj.hostname,
      port:     urlObj.port || (urlObj.protocol === 'https:' ? 443 : 80),
      path:     urlObj.pathname + urlObj.search,
      method:   options.method || 'GET',
      headers:  {
        'Content-Type': 'application/json',
        'x-user-id':    USER_ID,
        ...(options.headers || {}),
      },
    };

    const req = lib.request(reqOpts, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          const data = JSON.parse(body);
          if (res.statusCode >= 400) reject(new Error(data.error || `HTTP ${res.statusCode}`));
          else resolve(data.data);
        } catch {
          reject(new Error(`Invalid JSON response: ${body.slice(0, 100)}`));
        }
      });
    });

    req.on('error', reject);
    if (options.body) req.write(options.body);
    req.end();
  });
}

// Simpler version using fetch (Node 18+)
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
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data.data;
}

// ─── CONCURRENCY POOL ─────────────────────────────────────────────────────────

async function runWithConcurrency(tasks, limit, fn) {
  const results = [];
  const queue   = [...tasks];

  async function worker() {
    while (queue.length > 0) {
      const task = queue.shift();
      results.push(await fn(task).catch(err => ({ error: err.message, lead: task })));
    }
  }

  const workers = Array.from({ length: Math.min(limit, tasks.length) }, worker);
  await Promise.all(workers);
  return results;
}

// ─── MAIN ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('─'.repeat(60));
  console.log('🚀 AutoDemo — Génération en masse');
  console.log(`   Base URL   : ${BASE_URL}`);
  console.log(`   User ID    : ${USER_ID}`);
  console.log(`   Concurrence: ${CONCURRENCY}`);
  console.log(`   Filtre     : statut="${STATUS_FILTER}"`);
  console.log(`   Mode       : ${DRY_RUN ? '🔍 DRY RUN (aucune génération)' : '⚡ PRODUCTION'}`);
  console.log('─'.repeat(60));

  // 1. Fetch leads
  console.log('\n📋 Récupération des leads…');
  let leads;
  try {
    leads = await apiFetch('/leads');
  } catch (err) {
    console.error(`❌ Impossible de récupérer les leads: ${err.message}`);
    process.exit(1);
  }

  // 2. Filter
  const toProcess = STATUS_FILTER === 'all'
    ? leads
    : leads.filter(l => l.status === STATUS_FILTER);

  console.log(`   Total leads       : ${leads.length}`);
  console.log(`   À générer (${STATUS_FILTER}) : ${toProcess.length}`);

  if (toProcess.length === 0) {
    console.log('\n✅ Aucun lead à traiter. Fin du script.');
    return;
  }

  // 3. Check credits
  try {
    const { credits } = await apiFetch('/sites/credits');
    console.log(`\n💳 Crédits disponibles : ${credits}`);
    if (credits < toProcess.length) {
      console.warn(`⚠️  Crédits insuffisants pour traiter tous les leads (${credits} < ${toProcess.length})`);
      console.warn('   Les premières générations seront traitées jusqu\'à épuisement des crédits.');
    }
  } catch (err) {
    console.warn(`⚠️  Impossible de vérifier les crédits: ${err.message}`);
  }

  if (DRY_RUN) {
    console.log('\n🔍 Mode DRY RUN — leads qui seraient générés:');
    toProcess.forEach((l, i) => {
      console.log(`   ${i + 1}. [${l.id.slice(0, 8)}] ${l.name} (${l.city})`);
    });
    return;
  }

  // 4. Generate
  console.log(`\n⚡ Démarrage de la génération (concurrence: ${CONCURRENCY})…\n`);

  const stats = { success: 0, failed: 0, skipped: 0 };

  await runWithConcurrency(toProcess, CONCURRENCY, async (lead) => {
    const prefix = `   [${lead.name.slice(0, 24).padEnd(24)}]`;
    try {
      process.stdout.write(`${prefix} ⏳ Génération…`);
      const site = await apiFetch('/generate', {
        method: 'POST',
        body: JSON.stringify({ leadId: lead.id }),
      });
      process.stdout.write(`\r${prefix} ✅ ${site.url}\n`);
      stats.success++;
      return { success: true, lead, site };
    } catch (err) {
      process.stdout.write(`\r${prefix} ❌ ${err.message}\n`);
      stats.failed++;
      return { success: false, lead, error: err.message };
    }
  });

  // 5. Summary
  console.log('\n' + '─'.repeat(60));
  console.log('📊 Résumé:');
  console.log(`   ✅ Réussi  : ${stats.success}`);
  console.log(`   ❌ Échoué  : ${stats.failed}`);
  console.log(`   ⏭️  Ignoré  : ${stats.skipped}`);
  console.log('─'.repeat(60));
}

main().catch(err => {
  console.error('\n💥 Erreur fatale:', err.message);
  process.exit(1);
});
