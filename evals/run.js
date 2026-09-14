/**
 * run.js — Exécute le jeu d'évaluation et compare les versions de prompt.
 *
 * Usage :
 *   npm run eval                          # version active, sur le mock (gratuit)
 *   npm run eval -- --versions v1,v2      # compare deux prompts
 *   npm run eval -- --live                # appelle le vrai modèle (coût réel)
 *   npm run eval -- --live --runs 3       # 3 passes : mesure la variance
 *   npm run eval -- --case plombier-simple
 *   npm run eval -- --json rapport.json
 *
 * Sans --live, le contenu vient du générateur mock : l'exécution est gratuite,
 * déterministe, et vérifie que le harnais lui-même fonctionne. C'est ce qui
 * tourne en CI. Avec --live, chaque cas consomme un appel réel, et le coût
 * cumulé est affiché à la fin — une évaluation dont on ignore le prix ne sera
 * jamais relancée.
 */
import 'dotenv/config';
import { parseArgs } from 'node:util';
import { writeFileSync } from 'node:fs';
import { CASES, findCase } from './cases.js';
import { scoreContent } from './scorers.js';
import { getPrompt, listVersions, ACTIVE_VERSION } from '../src/ai/prompts/index.js';
import { estimateCost, formatCents } from '../src/ai/cost.js';
import { extractJson, generateMockContent } from '../src/services/aiService.js';
import { config } from '../src/config/config.js';

const { values: args } = parseArgs({
  options: {
    versions: { type: 'string' },
    case:     { type: 'string' },
    runs:     { type: 'string', default: '1' },
    live:     { type: 'boolean', default: false },
    json:     { type: 'string' },
  },
  strict: false,
});

const VERSIONS = (args.versions ?? ACTIVE_VERSION).split(',').map(s => s.trim()).filter(Boolean);
const RUNS  = Math.max(1, parseInt(args.runs) || 1);
const SUITE = args.case ? [findCase(args.case)].filter(Boolean) : CASES;
const LIVE  = args.live;

if (!SUITE.length) {
  console.error(`❌ Cas introuvable : ${args.case}`);
  process.exit(1);
}
for (const v of VERSIONS) {
  if (!listVersions().includes(v)) {
    console.error(`❌ Version inconnue : ${v}. Disponibles : ${listVersions().join(', ')}`);
    process.exit(1);
  }
}
if (LIVE && (!config.ai.apiKey || config.ai.apiKey === 'sk-...')) {
  console.error('❌ --live requiert AI_API_KEY.');
  process.exit(1);
}

/** Un appel réel, sans retry ni réparation : on évalue le prompt brut. */
async function callLive(lead, version) {
  const prompt = getPrompt(version);
  const started = Date.now();
  const res = await fetch(`${config.ai.baseUrl}/chat/completions`, {
    method: 'POST',
    signal: AbortSignal.timeout(config.generation.timeoutMs),
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${config.ai.apiKey}` },
    body: JSON.stringify({
      model: config.ai.model,
      messages: prompt.build(lead),
      max_tokens: config.ai.maxTokens,
      temperature: config.ai.temperature,
    }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);

  const data = await res.json();
  const raw = data.choices?.[0]?.message?.content;
  if (!raw) throw new Error('Réponse vide');

  const tokensIn  = data.usage?.prompt_tokens ?? 0;
  const tokensOut = data.usage?.completion_tokens ?? 0;
  return {
    content: extractJson(raw),
    tokensIn, tokensOut,
    durationMs: Date.now() - started,
    cost: estimateCost(config.ai.model, tokensIn, tokensOut),
  };
}

async function evaluate() {
  if (!LIVE) {
    console.log(
      '\n  ℹ️  Mode mock : le contenu vient du générateur de repli, pas du modèle.\n'
    + '     Utile pour vérifier le harnais et le contenu de secours — gratuit et\n'
    + '     déterministe, donc exécutable en CI. En revanche il ne DIFFÉRENCIE PAS\n'
    + '     les versions de prompt : pour les comparer, utilisez --live.'
    );
  }

  const report = {
    startedAt: new Date().toISOString(),
    mode: LIVE ? `live (${config.ai.model})` : 'mock',
    runs: RUNS, versions: {},
  };
  let totalCents = 0;

  for (const version of VERSIONS) {
    console.log(`\n${'━'.repeat(72)}`);
    console.log(`  PROMPT ${version} — ${getPrompt(version).description}`);
    console.log('━'.repeat(72));

    const rows = [];

    for (const testCase of SUITE) {
      const runs = [];
      for (let r = 0; r < RUNS; r++) {
        try {
          const out = LIVE
            ? await callLive(testCase.lead, version)
            : { content: generateMockContent(testCase.lead), cost: { cents: 0, known: true } };
          totalCents += out.cost?.cents ?? 0;
          runs.push(scoreContent(out.content, testCase.lead, testCase.lexicon));
        } catch (err) {
          runs.push({ overall: 0, results: [], failures: [`appel échoué : ${err.message}`] });
        }
      }

      const avg = runs.reduce((s, r) => s + r.overall, 0) / runs.length;
      const worst = Math.min(...runs.map(r => r.overall));
      const failures = [...new Set(runs.flatMap(r => r.failures))];

      rows.push({ id: testCase.id, avg, worst, failures, byScorer: runs[0].results });

      const bar = '█'.repeat(Math.round(avg * 20)).padEnd(20, '░');
      const flag = avg >= 0.9 ? '✅' : avg >= 0.7 ? '⚠️ ' : '❌';
      console.log(`\n${flag} ${testCase.id.padEnd(30)} ${bar} ${(avg * 100).toFixed(0)}%`);
      for (const f of failures.slice(0, 4)) console.log(`     · ${f}`);
    }

    const overall = rows.reduce((s, r) => s + r.avg, 0) / rows.length;

    // Score par critère, tous cas confondus : c'est ce qui dit QUOI corriger
    // dans le prompt, là où le score global dit seulement que ça va mal.
    const byScorer = {};
    for (const row of rows) {
      for (const s of row.byScorer) {
        (byScorer[s.id] ??= { label: s.label, scores: [] }).scores.push(s.score);
      }
    }
    console.log(`\n  Par critère :`);
    for (const [id, s] of Object.entries(byScorer)) {
      const m = s.scores.reduce((a, b) => a + b, 0) / s.scores.length;
      console.log(`    ${s.label.padEnd(30)} ${(m * 100).toFixed(0).padStart(3)}%${m < 0.8 ? '   ← à corriger' : ''}`);
      byScorer[id].mean = Math.round(m * 1000) / 1000;
    }
    console.log(`\n  ▸ Score global ${version} : ${(overall * 100).toFixed(1)}%`);

    report.versions[version] = {
      overall: Math.round(overall * 1000) / 1000,
      byScorer,
      cases: rows.map(({ id, avg, worst, failures }) => ({
        id, avg: Math.round(avg * 1000) / 1000, worst: Math.round(worst * 1000) / 1000, failures,
      })),
    };
  }

  // ── Comparaison ───────────────────────────────────────────────────────────
  if (VERSIONS.length > 1) {
    console.log(`\n${'━'.repeat(72)}\n  COMPARAISON\n${'━'.repeat(72)}`);
    const sorted = Object.entries(report.versions).sort((a, b) => b[1].overall - a[1].overall);
    for (const [v, data] of sorted) {
      console.log(`  ${v.padEnd(6)} ${(data.overall * 100).toFixed(1)}%`);
    }
    const [best, second] = sorted;
    const delta = (best[1].overall - second[1].overall) * 100;
    console.log(
      delta < 2
        ? `\n  ⚖️  Écart de ${delta.toFixed(1)} point — trop faible pour conclure.`
          + `\n     Relancez avec --runs 5 avant de basculer ACTIVE_VERSION.`
        : `\n  🏆 ${best[0]} devance ${second[0]} de ${delta.toFixed(1)} points.`
    );
  }

  if (LIVE) {
    const calls = VERSIONS.length * SUITE.length * RUNS;
    console.log(`\n  💸 ${calls} appels — coût estimé ${formatCents(totalCents)}`
              + ` (${formatCents(totalCents / calls)} par génération)`);
    report.costCents = Math.round(totalCents * 1e4) / 1e4;
  }

  if (args.json) {
    writeFileSync(args.json, JSON.stringify(report, null, 2));
    console.log(`\n  📄 Rapport écrit dans ${args.json}`);
  }

  console.log('');
  // Sortie non nulle si un prompt passe sous 70 % : utilisable comme garde CI.
  const worstVersion = Math.min(...Object.values(report.versions).map(v => v.overall));
  process.exit(worstVersion < 0.7 ? 1 : 0);
}

evaluate().catch(err => {
  console.error('\n💥 Évaluation interrompue :', err.message);
  process.exit(1);
});
