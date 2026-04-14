/**
 * emailWorker.js — Handler pour la queue "email"
 *
 * Responsabilité : envoyer l'email de prospection pour un site généré.
 * En entrée  : { siteId, userId }
 * En sortie  : { sent: true, to: string }
 *
 * Gestion SMTP via nodemailer (optionnel — le worker démarre même sans config SMTP,
 * il log un avertissement et marque le job comme ignoré).
 */

import { Site }    from '../db/models/Site.js';
import { Lead }    from '../db/models/Lead.js';
import { logger }  from '../utils/logger.js';
import { sleep }   from '../utils/utils.js';

// Lazy-load nodemailer (optional dependency)
let transporter = null;

async function getTransporter() {
  if (transporter) return transporter;

  const host = process.env.SMTP_HOST;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  if (!host || !user || !pass) return null;

  const port   = parseInt(process.env.SMTP_PORT ?? '587');
  const mailer = await import('nodemailer');

  const t = mailer.default.createTransport({
    host,
    port,
    secure: port === 465,
    auth: { user, pass },
  });

  try {
    await t.verify();
    transporter = t;
    logger.info('[EmailWorker] SMTP connection verified');
    return transporter;
  } catch (err) {
    logger.error('[EmailWorker] SMTP verify failed', { error: err.message });
    return null;
  }
}

function buildEmailHTML({ name, city, url, sender }) {
  return `<!DOCTYPE html>
<html lang="fr"><head><meta charset="UTF-8"><style>
  body{margin:0;padding:0;background:#f4f4f7;font-family:Arial,sans-serif}
  .wrap{max-width:580px;margin:0 auto;padding:20px}
  .card{background:#fff;border-radius:8px;box-shadow:0 2px 8px rgba(0,0,0,.08)}
  .head{background:linear-gradient(135deg,#6366f1,#8b5cf6);padding:28px;text-align:center;border-radius:8px 8px 0 0}
  .head h1{color:#fff;font-size:20px;margin:0}
  .body{padding:28px;color:#374151;font-size:14px;line-height:1.7}
  .cta{text-align:center;margin:24px 0}
  .cta a{background:#6366f1;color:#fff;text-decoration:none;padding:13px 30px;border-radius:6px;font-weight:bold}
  .foot{padding:16px 28px;border-top:1px solid #f0f0f0;font-size:12px;color:#9ca3af}
</style></head><body>
<div class="wrap"><div class="card">
  <div class="head"><h1>⚡ Votre site démo est prêt</h1></div>
  <div class="body">
    <p>Bonjour,</p>
    <p>Nous avons créé une démo personnalisée pour <strong>${name}</strong>${city ? ` à ${city}` : ''}.</p>
    <p>Ce site est optimisé pour attirer vos clients locaux et générer plus de contacts.</p>
    <div class="cta"><a href="${url}">🌐 Voir ma démo gratuite</a></div>
    <p>Répondez à cet email pour en discuter.</p>
    <p>Bonne journée,<br><strong>${sender}</strong></p>
  </div>
  <div class="foot">Pour ne plus recevoir nos emails, répondez avec "Désinscription".</div>
</div></div></body></html>`;
}

export async function emailHandler(job) {
  const { id: jobId, data } = job;
  const { siteId }          = data;

  logger.info('[EmailWorker] Processing', { jobId, siteId });

  // 1. Load site + lead
  const site = Site.findById(siteId);
  if (!site) throw new Error(`Site not found: ${siteId}`);

  const lead = Lead.findById(site.lead_id);
  if (!lead) throw new Error(`Lead not found for site ${siteId}`);

  if (!lead.email || !lead.email.includes('@')) {
    logger.warn('[EmailWorker] No valid email for lead, skipping', { leadId: lead.id });
    return { skipped: true, reason: 'no_email' };
  }

  // 2. Get SMTP transporter
  const smtp = await getTransporter();
  if (!smtp) {
    logger.warn('[EmailWorker] No SMTP config, skipping email', { siteId });
    return { skipped: true, reason: 'no_smtp' };
  }

  // 3. Build and send
  const sender = process.env.SMTP_SENDER_NAME ?? 'AutoDemo';
  const from   = process.env.SMTP_FROM ?? process.env.SMTP_USER;

  await smtp.sendMail({
    from:    `"${sender}" <${from}>`,
    to:      lead.email,
    subject: `${lead.name} — Votre site démo est prêt`,
    text:    `Bonjour,\n\nVotre démo est disponible : ${site.url}\n\nBonne journée,\n${sender}`,
    html:    buildEmailHTML({ name: lead.name, city: lead.city, url: site.url, sender }),
  });

  // Rate-limit courtesy delay between sends
  const delay = parseInt(process.env.EMAIL_SEND_DELAY_MS ?? '2000');
  if (delay > 0) await sleep(delay);

  logger.info('[EmailWorker] Email sent', { to: lead.email, siteId });
  return { sent: true, to: lead.email };
}
