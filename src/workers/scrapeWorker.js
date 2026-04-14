/**
 * scrapeWorker.js — Handler pour la queue "scrape"
 *
 * Responsabilité : valider et persister un lead brut.
 * En entrée  : { name, activity, city, email?, phone?, userId }
 * En sortie  : { leadId, status }
 *
 * Ce worker remplace l'étape 1 du pipeline.js d'origine.
 * Quand un lead est importé avec succès, il enqueue automatiquement
 * un job dans la generateQueue (chaînage de pipeline).
 */

import { Lead }             from '../db/models/Lead.js';
import { User }             from '../db/models/User.js';
import { generateQueue }    from './index.js';
import { sanitizeInput }    from '../utils/utils.js';
import { logger }           from '../utils/logger.js';
import { Errors }           from '../utils/AppError.js';

/**
 * Validation minimale côté worker (la validation HTTP est dans le middleware).
 * Ici on est défensif car les jobs peuvent venir de scripts CLI.
 */
function validateLeadData(data) {
  const errors = [];
  if (!data.name     || typeof data.name     !== 'string') errors.push('name requis');
  if (!data.activity || typeof data.activity !== 'string') errors.push('activity requis');
  if (!data.city     || typeof data.city     !== 'string') errors.push('city requis');
  if (!data.userId   || typeof data.userId   !== 'string') errors.push('userId requis');
  if (errors.length) throw new Error(errors.join(', '));
}

function sanitizeLead(data) {
  return {
    userId:   data.userId,
    name:     sanitizeInput(data.name),
    activity: sanitizeInput(data.activity),
    city:     sanitizeInput(data.city),
    email:    data.email ? sanitizeInput(data.email, 100) : null,
    phone:    data.phone ? sanitizeInput(data.phone, 30)  : null,
  };
}

export async function scrapeHandler(job) {
  const { id: jobId, data } = job;

  logger.info('[ScrapeWorker] Processing lead', { jobId, name: data.name, city: data.city });

  // 1. Validate
  validateLeadData(data);

  // 2. Check user exists
  const user = User.findById(data.userId);
  if (!user) throw new Error(`User not found: ${data.userId}`);

  // 3. Persist lead
  const clean = sanitizeLead(data);
  let lead;

  try {
    lead = Lead.create(clean);
    logger.info('[ScrapeWorker] Lead created', { leadId: lead.id, name: lead.name });
  } catch (err) {
    // SQLite UNIQUE constraint on email = duplicate — skip gracefully
    if (err.message.includes('UNIQUE')) {
      logger.warn('[ScrapeWorker] Duplicate lead skipped', { name: data.name, email: data.email });
      return { skipped: true, reason: 'duplicate' };
    }
    throw err;
  }

  // 4. Chain into generate queue (if requested)
  if (data.autoGenerate !== false) {
    generateQueue.add(
      { leadId: lead.id, userId: data.userId },
      { id: `gen-${lead.id}` },
    );
    logger.info('[ScrapeWorker] Enqueued generate job', { leadId: lead.id });
  }

  return { leadId: lead.id, status: 'imported' };
}
