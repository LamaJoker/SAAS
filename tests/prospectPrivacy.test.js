/**
 * prospectPrivacy.test.js — Droits des prospects.
 *
 * Ce que ces tests protègent : une demande d'effacement qui laisse la démo en
 * ligne, ou une purge qui emporte un lead engagé commercialement, sont les deux
 * façons de se tromper ici — l'une expose juridiquement, l'autre détruit du
 * chiffre d'affaires.
 */
import { beforeAll, beforeEach, describe, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { runMigrations, getDb } from '../src/db/database.js';
import { config } from '../src/config/config.js';
import {
  eraseProspect, purgeStaleLeads, purgeUnsubscribedDemos,
} from '../src/services/prospectPrivacyService.js';

let uid;
beforeAll(() => {
  runMigrations();
  uid = randomUUID();
  getDb().prepare('INSERT INTO users (id, email, credits) VALUES (?,?,0)')
    .run(uid, `privacy-${uid}@test.fr`);
});

beforeEach(() => {
  const db = getDb();
  db.prepare('DELETE FROM sites').run();
  db.prepare('DELETE FROM leads').run();
  db.prepare('DELETE FROM email_blacklist').run();
});

/** Crée un lead + sa démo, fichier sur disque compris. */
function seedLeadWithSite({ email, pipeline = 'nouveau', daysAgo = 0 }) {
  const db = getDb();
  const leadId = randomUUID();
  db.prepare(`INSERT INTO leads (id, user_id, name, activity, city, email, pipeline, source, created_at)
              VALUES (?,?,?,?,?,?,?,'google_maps', datetime('now', ?))`)
    .run(leadId, uid, 'Plomberie Test', 'plombier', 'Lyon', email, pipeline, `-${daysAgo} days`);

  const slug = `demo-${leadId.slice(0, 8)}`;
  const outputPath = join(config.paths.output, slug, 'index.html');
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, '<html>démo</html>');

  db.prepare('INSERT INTO sites (id, lead_id, user_id, slug, output_path, url) VALUES (?,?,?,?,?,?)')
    .run(randomUUID(), leadId, uid, slug, outputPath, `https://x.fr/demos/${slug}`);

  return { leadId, outputPath };
}

const leadCount = () => getDb().prepare('SELECT COUNT(*) n FROM leads').get().n;
const siteCount = () => getDb().prepare('SELECT COUNT(*) n FROM sites').get().n;

describe('eraseProspect', () => {
  it('supprime le lead, la démo, le fichier, et blackliste pour empêcher le re-scraping', async () => {
    const { outputPath } = seedLeadWithSite({ email: 'contact@a-effacer.fr' });
    expect(existsSync(outputPath)).toBe(true);

    const res = await eraseProspect('Contact@A-Effacer.fr');   // casse indifférente

    expect(res.leads).toBe(1);
    expect(leadCount()).toBe(0);
    expect(siteCount()).toBe(0);
    expect(existsSync(outputPath)).toBe(false);

    // Sans blacklist, le prochain scraping recréerait le lead et l'effacement
    // n'aurait servi à rien.
    const bl = getDb().prepare('SELECT reason FROM email_blacklist WHERE email = ?')
      .get('contact@a-effacer.fr');
    expect(bl?.reason).toBe('erasure_request');
  });

  it('refuse une adresse invalide', async () => {
    await expect(eraseProspect('pas-une-adresse')).rejects.toThrow(/invalide/i);
  });

  it('ne touche pas les autres prospects', async () => {
    seedLeadWithSite({ email: 'garde@moi.fr' });
    seedLeadWithSite({ email: 'efface@moi.fr' });

    await eraseProspect('efface@moi.fr');

    expect(leadCount()).toBe(1);
    expect(getDb().prepare('SELECT email FROM leads').get().email).toBe('garde@moi.fr');
  });
});

describe('purgeUnsubscribedDemos', () => {
  it('retire la démo publique d\'un prospect désinscrit', async () => {
    const { outputPath } = seedLeadWithSite({ email: 'stop@merci.fr' });
    getDb().prepare("INSERT INTO email_blacklist (email, reason) VALUES (?, 'unsubscribe')")
      .run('stop@merci.fr');

    const res = await purgeUnsubscribedDemos();

    expect(res.sites).toBe(1);
    expect(existsSync(outputPath)).toBe(false);
    // Le lead reste : il documente la demande de désinscription.
    expect(leadCount()).toBe(1);
  });

  it('laisse les démos des prospects non désinscrits', async () => {
    seedLeadWithSite({ email: 'ok@joignable.fr' });
    expect((await purgeUnsubscribedDemos()).sites).toBe(0);
    expect(siteCount()).toBe(1);
  });
});

describe('purgeStaleLeads', () => {
  it('supprime un lead ancien jamais engagé', async () => {
    seedLeadWithSite({ email: 'vieux@froid.fr', pipeline: 'nouveau', daysAgo: 1200 });
    const res = await purgeStaleLeads(1095);
    expect(res.leads).toBe(1);
    expect(leadCount()).toBe(0);
  });

  it('PRÉSERVE un lead ancien mais engagé commercialement', async () => {
    // Un prospect intéressé n'est pas de la prospection dormante : c'est une
    // relation d'affaires, sa suppression détruirait du chiffre.
    seedLeadWithSite({ email: 'interesse@client.fr', pipeline: 'interesse', daysAgo: 2000 });
    seedLeadWithSite({ email: 'signe@client.fr', pipeline: 'signe', daysAgo: 2000 });

    const res = await purgeStaleLeads(1095);

    expect(res.leads).toBe(0);
    expect(leadCount()).toBe(2);
  });

  it('préserve un lead récent', async () => {
    seedLeadWithSite({ email: 'recent@frais.fr', daysAgo: 10 });
    expect((await purgeStaleLeads(1095)).leads).toBe(0);
  });

  it('ne purge rien quand la rétention est désactivée (0)', async () => {
    seedLeadWithSite({ email: 'tres@vieux.fr', daysAgo: 9999 });
    const res = await purgeStaleLeads(0);
    expect(res.skipped).toBe(true);
    expect(leadCount()).toBe(1);
  });
});
