import { generateContent } from './aiService.js';
import { buildSite } from './siteBuilder.js';
import { Lead } from '../db/models/Lead.js';
import { Site } from '../db/models/Site.js';
import { User } from '../db/models/User.js';
import { generateSlug, withRetry } from '../utils/utils.js';
import { logger } from '../utils/logger.js';
import { Errors } from '../utils/AppError.js';
import { config } from '../config/config.js';
import { rm } from 'fs/promises';
import { join } from 'path';

/**
 * Fonction centrale de génération — isolée et testable indépendamment.
 * Prête pour être appelée depuis une queue (BullMQ, etc.) sans modification.
 */
export async function runGenerationJob({ userId, leadId }) {
  const lead = Lead.findById(leadId);
  if (!lead)                   throw Errors.notFound('Lead introuvable');
  if (lead.user_id !== userId) throw Errors.forbidden();

  const user = User.findById(userId);
  if (!user) throw Errors.unauthorized('Utilisateur introuvable');

  if (user.credits < config.credits.costPerGeneration) {
    throw Errors.paymentRequired(
      `Crédits insuffisants (${user.credits} disponible(s), ${config.credits.costPerGeneration} requis)`
    );
  }

  // Marquer comme en cours — ne débite pas encore
  Lead.updateStatus(leadId, 'processing');

  // Génération du contenu IA
  let content;
  try {
    content = await withRetry(
      () => generateContent(lead),
      config.generation.retryAttempts,
      config.generation.retryDelay
    );
  } catch (err) {
    Lead.updateStatus(leadId, 'error');
    logger.error('Génération IA échouée', { leadId, error: err.message });
    throw Errors.internal(`Génération IA échouée: ${err.message}`);
  }

  // Construction du site HTML
  const slug = generateSlug(lead);
  let outputPath;

  try {
    outputPath = await buildSite({ lead, content, slug });
  } catch (err) {
    Lead.updateStatus(leadId, 'error');
    logger.error('Build HTML échoué', { leadId, slug, error: err.message });
    throw Errors.internal(`Construction du site échouée: ${err.message}`);
  }

  // Déduction des crédits — atomique (UPDATE ... WHERE credits >= ?)
  const deducted = User.deductCredits(userId, config.credits.costPerGeneration);
  if (!deducted) {
    // Race condition rarissime — on rollback le fichier créé
    await rm(join(config.paths.output, slug), { recursive: true, force: true }).catch(() => {});
    Lead.updateStatus(leadId, 'error');
    throw Errors.paymentRequired('Crédits insuffisants (vérification finale échouée)');
  }

  const url  = `${config.server.baseUrl}/demos/${slug}`;
  const site = Site.create({ leadId, userId, slug, outputPath, url });
  Lead.updateStatus(leadId, 'done');

  logger.info('Site généré avec succès', { leadId, slug, url, userId });
  return site;
}

/**
 * Wrapper HTTP synchrone.
 * Pour passer en async : remplacer le corps par queue.add('generate', { userId, leadId })
 */
export async function generateSiteForLead({ userId, leadId }) {
  return runGenerationJob({ userId, leadId });
}

export async function getSitesForUser(userId) {
  return Site.findAllByUser(userId);
}
