import { generateSiteForLead } from '../services/siteService.js';
import { logger }              from '../utils/logger.js';

/**
 * Worker generate — délègue au GenerationService unique (même code que la
 * route POST /generate). Pas de réimplémentation : templateId, séquence email
 * et déduction transactionnelle des crédits sont gérés au même endroit.
 *
 * NB : le premier email (J0) est envoyé par la SÉQUENCE. generateSiteForLead
 * appelle enrollSite (next_send_at = now), que le sequenceWorker traite.
 * On n'ajoute donc PAS de job emailQueue ici, sinon le prospect recevrait
 * deux premiers emails (immédiat + séquence J0). La séquence est l'unique
 * propriétaire de l'outreach automatique ; /resend reste l'envoi manuel.
 */
export async function generateHandler(job) {
  const { leadId, userId, templateId } = job.data;

  const site = await generateSiteForLead({ userId, leadId, templateId });

  logger.info('[GenerateWorker] Site créé', { leadId, url: site.url });
  return { siteId: site.id, url: site.url };
}
