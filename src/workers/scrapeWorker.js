import { repo }          from '../db/repo.js';
import { generateQueue } from './index.js';
import { sanitizeInput } from '../utils/utils.js';
import { logger }        from '../utils/logger.js';
import { enrichLeadEmail } from '../services/enrichmentService.js';

function validateLeadData(data) {
  const errors = [];
  if (!data.name     || typeof data.name     !== 'string') errors.push('name requis');
  if (!data.activity || typeof data.activity !== 'string') errors.push('activity requis');
  if (!data.city     || typeof data.city     !== 'string') errors.push('city requis');
  if (!data.userId   || typeof data.userId   !== 'string') errors.push('userId requis');
  if (errors.length) throw new Error(errors.join(', '));
}

export async function scrapeHandler(job) {
  const { data } = job;
  validateLeadData(data);

  const user = await repo.users.findById(data.userId);
  if (!user) throw new Error(`Utilisateur introuvable: ${data.userId}`);

  const clean = {
    userId:   data.userId,
    name:     sanitizeInput(data.name),
    activity: sanitizeInput(data.activity),
    city:     sanitizeInput(data.city),
    email:    data.email ? sanitizeInput(data.email, 100) : null,
    phone:    data.phone ? sanitizeInput(data.phone, 30)  : null,
    website:  data.website || null,
    emailSource: data.email ? 'scrape' : null,
  };

  // Enrichissement : si pas d'email, tente d'en trouver un (sinon le lead ne
  // pourra être contacté que par WhatsApp). Dormant si ENRICHMENT_ENABLED≠true.
  if (!clean.email) {
    const enriched = await enrichLeadEmail({ ...clean, website: data.website });
    if (enriched.email) {
      clean.email = sanitizeInput(enriched.email, 100);
      clean.emailSource = enriched.source;
    }
  }

  let lead;
  try {
    lead = await repo.leads.create(clean);
    logger.info('[ScrapeWorker] Lead créé', { leadId: lead.id, name: lead.name });
  } catch (err) {
    if (err.message.includes('UNIQUE')) {
      logger.warn('[ScrapeWorker] Doublon ignoré', { name: data.name });
      return { skipped: true, reason: 'duplicate' };
    }
    throw err;
  }

  if (data.autoGenerate !== false) {
    generateQueue.add(
      { leadId: lead.id, userId: data.userId, templateId: data.templateId },
      { id: `gen-${lead.id}` }
    );
  }

  return { leadId: lead.id, status: 'imported' };
}
