/**
 * generateWorker.js — Handler pour la queue "generate"
 *
 * Responsabilité : générer le contenu IA, construire le HTML, déduire les crédits.
 * En entrée  : { leadId, userId }
 * En sortie  : { siteId, url }
 *
 * Ce worker remplace l'étape 2 du pipeline.js d'origine.
 * En cas de succès, il enqueue automatiquement un job dans emailQueue
 * si le lead possède une adresse email.
 */

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
  const { id: jobId, data } = job;
  const { leadId, userId }  = data;

  logger.info('[GenerateWorker] Processing', { jobId, leadId, userId });

  // 1. Load lead
  const lead = Lead.findById(leadId);
  if (!lead) throw new Error(`Lead not found: ${leadId}`);
  if (lead.user_id !== userId) throw new Error('Forbidden: lead belongs to another user');

  // 2. Load user + check credits
  const user = User.findById(userId);
  if (!user) throw new Error(`User not found: ${userId}`);

  const cost = config.credits.costPerGeneration;
  if (user.credits < cost) {
    // Mark lead as error so we don't retry indefinitely
    Lead.updateStatus(leadId, 'error');
    throw new Error(`Insufficient credits (${user.credits} available, ${cost} required)`);
  }

  // 3. Update lead status
  Lead.updateStatus(leadId, 'processing');

  // 4. Generate AI content
  let content;
  try {
    content = await generateContent(lead);
    logger.info('[GenerateWorker] AI content generated', { leadId });
  } catch (err) {
    Lead.updateStatus(leadId, 'error');
    throw new Error(`AI generation failed: ${err.message}`);
  }

  // 5. Build HTML site
  const slug = generateSlug(lead);
  let outputPath;
  try {
    outputPath = await buildSite({ lead, content, slug });
    logger.info('[GenerateWorker] Site built', { leadId, slug, outputPath });
  } catch (err) {
    Lead.updateStatus(leadId, 'error');
    throw new Error(`Site build failed: ${err.message}`);
  }

  // 6. Deduct credits (atomic — fails if concurrent drain)
  const deducted = User.deductCredits(userId, cost);
  if (!deducted) {
    // Cleanup orphaned files
    await rm(join(config.paths.output, slug), { recursive: true, force: true }).catch(() => {});
    Lead.updateStatus(leadId, 'error');
    throw new Error('Credit deduction failed (race condition or insufficient credits)');
  }

  // 7. Persist site record
  const url  = `${config.server.baseUrl}/demos/${slug}`;
  const site = Site.create({ leadId, userId, slug, outputPath, url });
  Lead.updateStatus(leadId, 'done');

  logger.info('[GenerateWorker] Site saved', { siteId: site.id, url });

  // 8. Chain into email queue if lead has an email
  if (lead.email) {
    emailQueue.add(
      { siteId: site.id, userId },
      { id: `email-${site.id}` },
    );
    logger.info('[GenerateWorker] Enqueued email job', { siteId: site.id });
  }

  return { siteId: site.id, url };
}
