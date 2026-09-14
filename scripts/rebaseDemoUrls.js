/**
 * rebaseDemoUrls.js — Réaligne les URL de démo déjà en base sur la config actuelle.
 *
 * Pourquoi c'est nécessaire
 * ─────────────────────────
 * L'URL d'une démo est figée dans `sites.url` au moment de la génération, parce
 * que c'est elle qui part dans les emails et qui doit rester stable. Conséquence :
 * changer DEMO_HOST / DEMO_BASE_URL n'affecte QUE les sites créés ensuite. Sans
 * ce script, une bascule de domaine laisse la base coupée en deux, et les démos
 * anciennes continuent d'être annoncées sur l'ancien domaine.
 *
 * Usage :
 *   node scripts/rebaseDemoUrls.js --dry-run   # montre ce qui changerait
 *   node scripts/rebaseDemoUrls.js             # applique
 *
 * Les emails DÉJÀ envoyés contiennent l'ancienne URL : gardez l'ancien domaine
 * actif en redirection quelques mois, sinon vous cassez des liens en circulation.
 */
import 'dotenv/config';
import { parseArgs } from 'node:util';
import { runMigrations, getDb } from '../src/db/database.js';
import { buildDemoUrl } from '../src/utils/demoUrl.js';
import { config } from '../src/config/config.js';

const { values: args } = parseArgs({
  options: { 'dry-run': { type: 'boolean', default: false } },
  strict: false,
});
const DRY_RUN = args['dry-run'];

function main() {
  runMigrations();
  const db = getDb();

  const sites = db.prepare('SELECT id, slug, url FROM sites').all();
  const stale = sites
    .map(s => ({ ...s, next: buildDemoUrl(s.slug) }))
    .filter(s => s.next !== s.url);

  console.log('─'.repeat(64));
  console.log('🔗 Rebasage des URL de démo');
  console.log(`   Domaine cible : ${config.server.demoBaseUrl || config.server.baseUrl}`);
  console.log(`   Sites en base : ${sites.length}`);
  console.log(`   À réaligner   : ${stale.length}`);
  console.log(`   Mode          : ${DRY_RUN ? '🔍 DRY RUN' : '⚡ ÉCRITURE'}`);
  console.log('─'.repeat(64));

  if (!stale.length) {
    console.log('\n✅ Toutes les URL sont déjà alignées.');
    return;
  }

  for (const s of stale.slice(0, 10)) {
    console.log(`   ${s.url}\n → ${s.next}\n`);
  }
  if (stale.length > 10) console.log(`   … et ${stale.length - 10} autres\n`);

  if (DRY_RUN) {
    console.log('🔍 Rien n\'a été écrit. Relancez sans --dry-run pour appliquer.');
    return;
  }

  const update = db.prepare('UPDATE sites SET url = ? WHERE id = ?');
  const run = db.transaction(rows => {
    for (const r of rows) update.run(r.next, r.id);
  });
  run(stale);

  console.log(`✅ ${stale.length} URL mises à jour.`);
  console.log('⚠️  Gardez l\'ancien domaine en redirection : les emails déjà envoyés');
  console.log('   pointent encore vers lui.');
}

main();
