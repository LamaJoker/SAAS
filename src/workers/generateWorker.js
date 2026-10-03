import { generateSiteForLead, ALREADY_GENERATED } from '../services/siteService.js';
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

  let site;
  try {
    site = await generateSiteForLead({ userId, leadId, templateId });
  } catch (err) {
    // Le site existe déjà : l'objectif du job est atteint. Le relancer ne
    // ferait que consommer des tentatives pour rien.
    if (err.code === ALREADY_GENERATED) {
      logger.info('[GenerateWorker] Site déjà présent — job ignoré', { leadId });
      return { skipped: true, reason: 'already_generated' };
    }
    throw err;
  }

  logger.info('[GenerateWorker] Site créé', { leadId, url: site.url });
  return { siteId: site.id, url: site.url };
}
