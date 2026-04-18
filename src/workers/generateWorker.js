import { Lead }            from '../db/models/Lead.js';
import { Site }            from '../db/models/Site.js';
import { User }            from '../db/models/User.js';
import { generateContent } from '../services/aiService.js';
import { buildSite }       from '../services/siteBuilder.js';
import { emailQueue }      from './index.js';
import { generateSlug }    from '../utils/utils.js';
import { logger }          from '../utils/logger.js';
import { config }          from '../config/config.js';
import { rm }              from 'fs/promises';
import { join }            from 'path';

export async function generateHandler(job) {
  const { leadId, userId } = job.data;

  const lead = Lead.findById(leadId);
  if (!lead) throw new Error(`Lead introuvable: ${leadId}`);
  if (lead.user_id !== userId) throw new Error('Accès refusé');

  const user = User.findById(userId);
  if (!user) throw new Error(`Utilisateur introuvable: ${userId}`);

  const cost = config.credits.costPerGeneration;
  if (user.credits < cost) {
    Lead.updateStatus(leadId, 'error');
    throw new Error(`Crédits insuffisants (${user.credits} disponible, ${cost} requis)`);
  }

  Lead.updateStatus(leadId, 'processing');

  let content;
  try {
    content = await generateContent(lead);
  } catch (err) {
    Lead.updateStatus(leadId, 'error');
    throw new Error(`IA échouée: ${err.message}`);
  }

  const slug = generateSlug(lead);
  let outputPath;
  try {
    outputPath = await buildSite({ lead, content, slug });
  } catch (err) {
    Lead.updateStatus(leadId, 'error');
    throw new Error(`Build échoué: ${err.message}`);
  }

  const deducted = User.deductCredits(userId, cost);
  if (!deducted) {
    await rm(join(config.paths.output, slug), { recursive: true, force: true }).catch(() => {});
    Lead.updateStatus(leadId, 'error');
    throw new Error('Déduction crédits échouée (concurrence)');
  }

  const url  = `${config.server.baseUrl}/demos/${slug}`;
  const site = Site.create({ leadId, userId, slug, outputPath, url });
  Lead.updateStatus(leadId, 'done');

  logger.info('[GenerateWorker] Site créé', { leadId, url });

  if (lead.email) {
    emailQueue.add({ siteId: site.id, userId }, { id: `email-${site.id}` });
  }

  return { siteId: site.id, url };
}
