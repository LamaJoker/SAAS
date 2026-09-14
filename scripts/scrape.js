#!/usr/bin/env node
/**
 * scripts/scrape.js — Scraping Google Maps + injection en base
 *
 * Usage:
 *   node scripts/scrape.js --city Lyon --activity plombier
 *   node scripts/scrape.js --city Lyon --all-activities
 *   node scripts/scrape.js --cities Lyon,Bordeaux,Nantes --activity électricien --auto-generate
 *
 * Options:
 *   --city          Ville cible
 *   --cities        Liste de villes (séparées par virgule)
 *   --activity      Activité à cibler
 *   --all-activities Scrape toutes les activités haute valeur
 *   --auto-generate  Lance la génération de site après import
 *   --max           Nombre max de résultats par recherche (défaut: 30)
 *   --dry-run       Affiche sans persister
 *   --userId        ID utilisateur pour rattacher les leads
 */

import { parseArgs }        from 'node:util';
import dotenv               from 'dotenv';
import { scrapeGoogleMaps, HIGH_VALUE_TARGETS } from '../src/scrapers/googleMapsScraper.js';
import { Lead }             from '../src/db/models/Lead.js';
import { runMigrations }    from '../src/db/database.js';
import { scoreLead }        from '../src/services/sequenceService.js';

dotenv.config();

const { values: args } = parseArgs({
  options: {
    city:            { type: 'string' },
    cities:          { type: 'string' },
    activity:        { type: 'string' },
    'all-activities':{ type: 'boolean', default: false },
    'auto-generate': { type: 'boolean', default: false },
    max:             { type: 'string',  default: '30' },
    'dry-run':       { type: 'boolean', default: false },
    userId:          { type: 'string' },
  },
  strict: false,
});

const USER_ID    = args.userId    || process.env.USER_ID;
const DRY_RUN    = args['dry-run'];
const MAX        = parseInt(args.max || '30');
const ALL_ACTS   = args['all-activities'];
const AUTO_GEN   = args['auto-generate'];

const cities     = args.cities
  ? args.cities.split(',').map(s => s.trim())
  : args.city ? [args.city] : [];

const activities = ALL_ACTS
  ? HIGH_VALUE_TARGETS
  : args.activity ? [args.activity] : [];

if (!cities.length || !activities.length) {
  console.error('❌  Usage: node scripts/scrape.js --city Lyon --activity plombier');
  console.error('           node scripts/scrape.js --cities Lyon,Bordeaux --all-activities');
  process.exit(1);
}

if (!USER_ID && !DRY_RUN) {
  console.error('❌  --userId requis (ou USER_ID dans .env)');
  process.exit(1);
}

async function main() {
  if (!DRY_RUN) runMigrations();

  const stats = { scraped: 0, imported: 0, duplicates: 0, errors: 0 };

  for (const city of cities) {
    for (const activity of activities) {
      console.log(`\n🔍 Scraping: "${activity}" à ${city}…`);

      let results;
      try {
        results = await scrapeGoogleMaps(activity, city, {
          filterNoWebsite: true,
          maxResults: MAX,
        });
      } catch (err) {
        console.error(`❌ Erreur scraping "${activity}" ${city}: ${err.message}`);
        stats.errors++;
        continue;
      }

      console.log(`   → ${results.length} leads trouvés`);
      stats.scraped += results.length;

      for (const r of results) {
        if (DRY_RUN) {
          console.log(`   [DRY] ${r.name} | ${r.phone || 'no phone'} | score: ${scoreLead(r, null)}`);
          stats.imported++;
          continue;
        }

        try {
          const lead = Lead.create({
            userId:   USER_ID,
            name:     r.name,
            activity: r.activity || activity,
            city:     r.city || city,
            email:    r.email || null,
            phone:    r.phone || null,
          });

          // Score pour priorisation
          const score = scoreLead({ ...r, created_at: new Date().toISOString() }, null);
          console.log(`   ✅ ${r.name} (score: ${score})`);
          stats.imported++;

          // Auto-génération si demandée et lead a un email
          if (AUTO_GEN && lead.email) {
            const { generateSiteForLead } = await import('../src/services/siteService.js');
            try {
              const site = await generateSiteForLead({ userId: USER_ID, leadId: lead.id });
              console.log(`      ⚡ Site généré: ${site.url}`);
            } catch (genErr) {
              console.warn(`      ⚠️  Génération échouée: ${genErr.message}`);
            }
          }

        } catch (err) {
          if (err.message.includes('UNIQUE')) {
            stats.duplicates++;
          } else {
            console.warn(`   ⚠️  Import échoué (${r.name}): ${err.message}`);
            stats.errors++;
          }
        }
      }

      // Pause entre les recherches
      await new Promise(r => setTimeout(r, 4000 + Math.random() * 2000));
    }
  }

  console.log('\n' + '═'.repeat(50));
  console.log('📊 Résumé scraping');
  console.log(`   Scrapés    : ${stats.scraped}`);
  console.log(`   Importés   : ${stats.imported}`);
  console.log(`   Doublons   : ${stats.duplicates}`);
  console.log(`   Erreurs    : ${stats.errors}`);
  console.log('═'.repeat(50));
}

main().catch(err => {
  console.error('💥', err.message);
  process.exit(1);
});
