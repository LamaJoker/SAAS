import { Site }          from '../db/models/Site.js';
import { Lead }          from '../db/models/Lead.js';
import { sendDemoEmail } from '../services/emailService.js';
import { logger }        from '../utils/logger.js';

export async function emailHandler(job) {
  const { siteId } = job.data;

  const site = Site.findById(siteId);
  if (!site) throw new Error(`Site introuvable: ${siteId}`);

  const lead = Lead.findById(site.lead_id);
  if (!lead?.email) {
    logger.info('[EmailWorker] Pas d\'email pour ce lead', { siteId });
    return { skipped: true, reason: 'no_email' };
  }

  const result = await sendDemoEmail({ lead, site });

  if (result.skipped) {
    logger.info('[EmailWorker] Email ignoré', { siteId, reason: result.reason });
    return result;
  }

  logger.info('[EmailWorker] Email envoyé', { siteId, leadEmail: lead.email });
  return result;
}
