import { Site }    from '../db/models/Site.js';
import { Lead }    from '../db/models/Lead.js';
import { logger }  from '../utils/logger.js';
import nodemailer from 'nodemailer';

export async function emailHandler(job) {
  const { siteId } = job.data;
  const site = Site.findById(siteId);
  const lead = Lead.findById(site.lead_id);
  
  if (!lead.email) return { skipped: true };

  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: process.env.SMTP_PORT,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
  });

  const unsubToken = Buffer.from(lead.email).toString('base64');
  const unsubUrl = `${process.env.BASE_URL}/unsubscribe/${unsubToken}`;

  await transporter.sendMail({
    from: `"${process.env.SMTP_SENDER_NAME}" <${process.env.SMTP_USER}>`,
    to: lead.email,
    subject: `J'ai créé quelque chose pour ${lead.name}`,
    headers: {
      'List-Unsubscribe': `<${unsubUrl}>`,
      'X-Entity-ID': lead.id,
      'Precedence': 'bulk'
    },
    html: `
      <p>Bonjour ${lead.name},</p>
      <p>J'ai préparé une maquette pour votre activité de <strong>${lead.activity}</strong> à ${lead.city}.</p>
      <p><a href="${site.url}" style="background:#2563eb; color:white; padding:12px 24px; text-decoration:none; border-radius:8px;">Voir la démo ici</a></p>
      <hr>
      <p style="font-size:10px; color:grey;">Si vous ne souhaitez plus recevoir d'emails : <a href="${unsubUrl}">se désabonner</a></p>
    `
  });

  logger.info(`[Email] Envoyé à ${lead.email}`);
  return { sent: true };
}