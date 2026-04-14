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

export async function runGenerationJob({ userId, leadId }) {
  const lead = Lead.findById(leadId);
  if (!lead) throw Errors.notFound('Lead introuvable');
  if (lead.user_id !== userId) throw Errors.forbidden();

  const user = User.findById(userId);
  if (!user) throw Errors.unauthorized('Utilisateur introuvable');
  if (user.credits < config.credits.costPerGeneration) {
    throw Errors.paymentRequired(`Crédits insuffisants (${user.credits} disponible(s))`);
  }

  Lead.updateStatus(leadId, 'processing');
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

  const slug = generateSlug(lead);
  let outputPath;
  try {
    outputPath = await buildSite({ lead, content, slug });
  } catch (err) {
    Lead.updateStatus(leadId, 'error');
    logger.error('Build HTML échoué', { leadId, slug, error: err.message });
    throw Errors.internal(`Construction du site échouée: ${err.message}`);
  }

  const deducted = User.deductCredits(userId, config.credits.costPerGeneration);
  if (!deducted) {
    await rm(join(config.paths.output, slug), { recursive: true, force: true }).catch(() => {});
    Lead.updateStatus(leadId, 'error');
    throw Errors.paymentRequired('Crédits insuffisants (vérification finale échouée)');
  }

  const url = `${config.server.baseUrl}/demos/${slug}`;
  const site = Site.create({ leadId, userId, slug, outputPath, url });
  Lead.updateStatus(leadId, 'done');

  logger.info('Site généré avec succès', { leadId, slug, url, userId });
  return site;
}

export async function generateSiteForLead({ userId, leadId }) {
  return runGenerationJob({ userId, leadId });
}

export async function getSitesForUser(userId) {
  return Site.findAllByUser(userId);
}