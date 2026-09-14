import { generateContent }    from './aiService.js';
import { buildSite }         from './siteBuilder.js';
import { Lead }              from '../db/models/Lead.js';
import { Site }              from '../db/models/Site.js';
import { User }              from '../db/models/User.js';
import { repo }              from '../db/repo.js';
import { getDb }             from '../db/database.js';
import { generateSlug, withRetry } from '../utils/utils.js';
import { logger }            from '../utils/logger.js';
import { Errors }            from '../utils/AppError.js';
import { buildDemoUrl } from '../utils/demoUrl.js';
import { config }            from '../config/config.js';
import { rm }                from 'fs/promises';
import { join }              from 'path';
import { enrollSite, scoreLead, pickChannel } from './sequenceService.js';
import { DEFAULT_TEMPLATE_ID, isValidTemplateId } from './templateService.js';

/**
 * GenerationService — cas d'usage UNIQUE de génération d'un site pour un lead.
 * Appelé à la fois par la route POST /generate (synchrone) et par le worker
 * generate (asynchrone via la file). Une seule implémentation = pas de
 * divergence (templateId, séquence email, déduction crédits…).
 *
 * Atomicité : les effets de bord réseau (IA) et disque (HTML) ont lieu AVANT
 * la transaction DB. La mutation métier — déduction crédits + création site +
 * statut lead + enrôlement séquence — est encapsulée dans une transaction
 * better-sqlite3 (synchrone). Si elle échoue, on compense le fichier déjà écrit.
 */
export async function generateSiteForLead({ userId, leadId, templateId = DEFAULT_TEMPLATE_ID }) {
  if (!isValidTemplateId(templateId)) templateId = DEFAULT_TEMPLATE_ID;

  const lead = await repo.leads.findById(leadId);
  if (!lead)                   throw Errors.notFound('Lead introuvable');
  if (lead.user_id !== userId) throw Errors.forbidden();

  const user = await repo.users.findById(userId);
  if (!user) throw Errors.unauthorized('Utilisateur introuvable');

  const cost = config.credits.costPerGeneration;
  if (user.credits < cost) {
    throw Errors.paymentRequired(`Crédits insuffisants (${user.credits} disponible(s))`);
  }

  await repo.leads.updateStatus(leadId, 'processing');

  // ── Effets de bord hors transaction (async : réseau + disque) ──────────────
  let content;
  try {
    content = await withRetry(
      () => generateContent(lead),
      config.generation.retryAttempts,
      config.generation.retryDelay
    );
  } catch (err) {
    await repo.leads.updateStatus(leadId, 'error');
    logger.error('Génération IA échouée', { leadId, error: err.message });
    throw Errors.internal(`Génération IA échouée: ${err.message}`);
  }

  const slug = generateSlug(lead);
  let outputPath;
  try {
    outputPath = await buildSite({ lead, content, slug, templateId });
  } catch (err) {
    await repo.leads.updateStatus(leadId, 'error');
    logger.error('Build HTML échoué', { leadId, slug, error: err.message });
    throw Errors.internal(`Construction du site échouée: ${err.message}`);
  }

  // ── Transaction métier (synchrone, atomique) ───────────────────────────────
  const url = buildDemoUrl(slug);
  const db  = getDb();

  const commit = db.transaction(() => {
    // Déduction conditionnelle : si un autre process a vidé les crédits entre
    // le check et ici, deductCredits renvoie false → on annule toute la tx.
    if (!User.deductCredits(userId, cost)) {
      throw Errors.paymentRequired('Crédits insuffisants (vérification finale)');
    }
    const site = Site.create({ leadId, userId, slug, outputPath, url, template: templateId });
    Lead.updateStatus(leadId, 'done');

    // Enrôlement séquence dans la MÊME transaction (cohérence garantie).
    // Canal : email si dispo, sinon WhatsApp si activé + téléphone, sinon aucun.
    const channel = pickChannel(lead);
    if (channel) {
      enrollSite(site.id, leadId, scoreLead(lead, site), channel);
    }
    return site;
  });

  let site;
  try {
    site = commit();
  } catch (err) {
    // Compensation explicite du fichier : la DB a rollback, le HTML orphelin
    // doit disparaître pour ne pas laisser un site sans enregistrement.
    await rm(join(config.paths.output, slug), { recursive: true, force: true }).catch(() => {});
    await repo.leads.updateStatus(leadId, 'error');
    throw err;
  }

  logger.info('Site généré', { leadId, slug, url, userId, template: templateId });
  return site;
}

export async function getSitesForUser(userId) {
  return repo.sites.findAllByUser(userId);
}
