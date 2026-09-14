/**
 * prospectPrivacyService.js — Droits des personnes côté PROSPECTS.
 *
 * Distinction importante
 * ──────────────────────
 * L'export RGPD existant (`/users/me/export`) concerne les CLIENTS du SaaS :
 * des gens qui ont créé un compte et accepté des CGU. Ce fichier concerne les
 * PROSPECTS : des entreprises scrapées qui n'ont jamais rien signé, jamais
 * consenti, et dont on stocke le nom, le téléphone et parfois l'email.
 *
 * C'est l'exposition juridique la plus sérieuse du produit, et elle n'était pas
 * couverte : se désinscrire blacklistait l'adresse mais ne supprimait ni le
 * lead, ni la démo publique portant le nom de l'entreprise.
 *
 * Trois obligations, trois fonctions :
 *   - droit à l'effacement      → eraseProspect()
 *   - limitation de conservation → purgeStaleLeads()
 *   - preuve de la base légale   → colonne leads.source (migration 12)
 *
 * Durée retenue : 1095 jours (3 ans). C'est la durée que la CNIL admet pour des
 * données de prospection commerciale, comptée depuis le dernier contact. Au-delà,
 * une donnée jamais convertie n'a plus de justification d'être conservée — et
 * elle n'a plus de valeur commerciale non plus, ce qui rend l'arbitrage simple.
 */
import { rm } from 'node:fs/promises';
import { dirname } from 'node:path';
import { getDb } from '../db/database.js';
import { blacklistEmail } from '../db/queries.js';
import { logger } from '../utils/logger.js';

const DEFAULT_LEAD_RETENTION_DAYS = 1095;

export function leadRetentionDays() {
  const raw = parseInt(process.env.LEAD_RETENTION_DAYS ?? String(DEFAULT_LEAD_RETENTION_DAYS), 10);
  return Number.isFinite(raw) && raw >= 0 ? raw : DEFAULT_LEAD_RETENTION_DAYS;
}

/**
 * Supprime du disque les dossiers de démo listés, sans jamais faire échouer
 * l'appelant : la suppression en base est la partie qui a une valeur juridique,
 * un fichier résiduel se rattrape, une transaction annulée non.
 */
async function removeSiteFiles(paths) {
  let removed = 0;
  for (const p of paths) {
    if (!p) continue;
    try {
      // output_path pointe vers .../<slug>/index.html : c'est le DOSSIER qu'on retire.
      await rm(dirname(p), { recursive: true, force: true });
      removed++;
    } catch (err) {
      logger.warn('[Privacy] Suppression de fichier échouée', { path: p, error: err.message });
    }
  }
  return removed;
}

/**
 * Efface toute trace d'un prospect, tous comptes confondus.
 *
 * Volontairement global : si une entreprise demande l'effacement, elle ne va pas
 * répéter la demande à chacun de vos clients qui l'a scrapée. L'adresse est
 * aussi blacklistée — sans quoi le prochain scraping la recréerait, et la
 * demande d'effacement n'aurait servi à rien.
 *
 * @param {string} email
 * @returns {Promise<{ leads: number, sites: number, filesRemoved: number }>}
 */
export async function eraseProspect(email) {
  const addr = String(email || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(addr)) {
    throw new Error('Adresse email invalide');
  }

  const db = getDb();
  const sites = db.prepare(
    'SELECT s.id, s.output_path FROM sites s JOIN leads l ON l.id = s.lead_id WHERE lower(l.email) = ?'
  ).all(addr);

  // Blacklist d'abord : même si la suppression échoue, le prospect cesse d'être
  // sollicité. L'inverse laisserait une fenêtre où il est effacé puis re-scrapé.
  await blacklistEmail(addr, 'erasure_request');

  const erased = db.transaction(() => {
    // Les sites, events et séquences partent en cascade depuis leads.
    return db.prepare('DELETE FROM leads WHERE lower(email) = ?').run(addr).changes;
  })();

  const filesRemoved = await removeSiteFiles(sites.map(s => s.output_path));

  logger.warn('[Privacy] Effacement prospect exécuté', {
    email: addr, leads: erased, sites: sites.length, filesRemoved,
  });
  return { leads: erased, sites: sites.length, filesRemoved };
}

/**
 * Purge les leads périmés : jamais convertis, sans contact depuis la fenêtre de
 * rétention. Les leads engagés commercialement (intéressé, rappeler, signé) sont
 * préservés quel que soit leur âge — ce sont des relations d'affaires, pas de
 * la prospection dormante.
 *
 * @param {number} [days]
 * @returns {Promise<{ leads: number, filesRemoved: number, skipped?: true }>}
 */
export async function purgeStaleLeads(days = leadRetentionDays()) {
  if (days === 0) return { leads: 0, filesRemoved: 0, skipped: true };

  const db = getDb();
  const cutoff = `-${parseInt(days, 10)} days`;

  const WHERE = `
    created_at < datetime('now', ?)
    AND (pipeline IS NULL OR pipeline IN ('nouveau', 'contacte', 'perdu'))
    AND id NOT IN (SELECT lead_id FROM email_events WHERE lead_id IS NOT NULL AND event_type IN ('open','click'))
  `;

  const sites = db.prepare(
    `SELECT output_path FROM sites WHERE lead_id IN (SELECT id FROM leads WHERE ${WHERE})`
  ).all(cutoff);

  const leads = db.transaction(() =>
    db.prepare(`DELETE FROM leads WHERE ${WHERE}`).run(cutoff).changes
  )();

  const filesRemoved = await removeSiteFiles(sites.map(s => s.output_path));

  if (leads) {
    logger.info('[Privacy] Leads périmés purgés', { days, leads, filesRemoved });
  }
  return { leads, filesRemoved };
}

/**
 * Retire les démos des prospects qui ont demandé à ne plus être contactés.
 *
 * Un désabonnement ne peut pas laisser en ligne une page publique portant le nom
 * et le téléphone de l'entreprise. Contrairement à la purge par ancienneté, il
 * n'y a ici aucun arbitrage à faire : la personne a dit non.
 *
 * @returns {Promise<{ sites: number, filesRemoved: number }>}
 */
export async function purgeUnsubscribedDemos() {
  const db = getDb();
  const sites = db.prepare(`
    SELECT s.id, s.output_path
      FROM sites s
      JOIN leads l ON l.id = s.lead_id
     WHERE lower(l.email) IN (SELECT lower(email) FROM email_blacklist)
  `).all();

  if (!sites.length) return { sites: 0, filesRemoved: 0 };

  const del = db.prepare('DELETE FROM sites WHERE id = ?');
  db.transaction(() => { for (const s of sites) del.run(s.id); })();

  const filesRemoved = await removeSiteFiles(sites.map(s => s.output_path));
  logger.info('[Privacy] Démos de prospects désinscrits retirées', {
    sites: sites.length, filesRemoved,
  });
  return { sites: sites.length, filesRemoved };
}

/** Passe quotidienne : désinscrits d'abord (non négociable), puis périmés. */
export function startPrivacyScheduler() {
  const DAY = 24 * 3_600_000;
  const pass = async () => {
    try {
      await purgeUnsubscribedDemos();
      await purgeStaleLeads();
    } catch (err) {
      logger.error('[Privacy] Passe de purge échouée', { error: err.message });
    }
  };

  const first = setTimeout(() => {
    pass();
    const interval = setInterval(pass, DAY);
    interval.unref();
  }, 35 * 60_000);   // décalé du backup (5 min) et de la rétention (20 min)
  first.unref();
}
