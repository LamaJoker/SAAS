import { smtpPool } from './smtpPool.js';
import { repo }     from '../db/repo.js';
import { staleHotLeads, markHotLeadReminded } from '../db/queries.js';
import { sanitize } from '../utils/utils.js';
import { logger }   from '../utils/logger.js';
import { config }   from '../config/config.js';
import { buildCrmToken } from '../utils/crmToken.js';

/**
 * Notifie le propriétaire du compte qu'un prospect a soumis le formulaire
 * de contact d'une de ses démos. Un prospect rappelé dans l'heure convertit
 * bien mieux — cette notification doit partir immédiatement.
 *
 * Non bloquant : un échec est loggé, jamais propagé à la requête du prospect.
 */
export async function notifyHotLead({ userId, site, leadId = null, leadName, contact }) {
  try {
    if (!smtpPool.isConfigured) return { skipped: true, reason: 'smtp_not_configured' };

    const owner = await repo.users.findById(userId);
    if (!owner?.email) return { skipped: true, reason: 'no_owner_email' };

    const name    = sanitize(contact.name    || '');
    const phone   = sanitize(contact.phone   || '');
    const email   = sanitize(contact.email   || '');
    const message = sanitize(contact.message || '');

    const lines = [
      `<p style="margin:0 0 4px"><strong>${name}</strong></p>`,
      phone   ? `<p style="margin:0 0 4px">📞 <a href="tel:${phone}">${phone}</a></p>` : '',
      email   ? `<p style="margin:0 0 4px">✉️ <a href="mailto:${email}">${email}</a></p>` : '',
      message ? `<p style="margin:12px 0 0;padding:12px;background:#f5f5f5;border-radius:6px">"${message}"</p>` : '',
    ].filter(Boolean).join('\n');

    // Actions en un clic : mise à jour du CRM sans login (token HMAC, 7 jours)
    const quickActions = leadId ? `
  <p style="margin:20px 0 0;font-size:13px;color:#555">Après votre appel, un clic suffit :</p>
  <p style="margin:8px 0 0">
    <a href="${config.server.baseUrl}/crm/quick/${buildCrmToken(leadId, 'converti')}"
       style="background:#16a34a;color:#fff;padding:8px 14px;border-radius:6px;text-decoration:none;font-size:13px;margin-right:6px">✅ Converti</a>
    <a href="${config.server.baseUrl}/crm/quick/${buildCrmToken(leadId, 'contacte')}"
       style="background:#2563eb;color:#fff;padding:8px 14px;border-radius:6px;text-decoration:none;font-size:13px;margin-right:6px">☎️ Rappelé</a>
    <a href="${config.server.baseUrl}/crm/quick/${buildCrmToken(leadId, 'perdu')}"
       style="background:#6b7280;color:#fff;padding:8px 14px;border-radius:6px;text-decoration:none;font-size:13px">❌ Perdu</a>
  </p>` : '';

    await smtpPool.send({
      to:      owner.email,
      subject: `🔥 Prospect chaud — ${leadName} (${site.slug})`,
      text:
`Un prospect vient de remplir le formulaire de contact sur la démo "${leadName}".

Nom : ${contact.name || '—'}
Téléphone : ${contact.phone || '—'}
Email : ${contact.email || '—'}
Message : ${contact.message || '—'}

Démo : ${site.url}

Rappelez-le rapidement — un prospect contacté dans l'heure convertit beaucoup mieux.`,
      html: `
<div style="font-family:Arial,sans-serif;font-size:14px;color:#222;max-width:520px;line-height:1.6">
  <p style="font-size:16px"><strong>🔥 Prospect chaud !</strong></p>
  <p>Quelqu'un vient de remplir le formulaire de contact sur la démo <strong>${sanitize(leadName)}</strong> :</p>
  <div style="border-left:3px solid #16a34a;padding-left:14px;margin:16px 0">
    ${lines}
  </div>
  <p><a href="${site.url}" style="color:#2563eb">Voir la démo →</a> ·
     <a href="${config.server.baseUrl}/dashboard.html" style="color:#2563eb">Ouvrir le dashboard →</a></p>
  ${quickActions}
  <p style="color:#888;font-size:12px;margin-top:20px">Conseil : rappelez dans l'heure, c'est là que ça convertit.</p>
</div>`,
    });

    logger.info('[Notify] Hot lead notifié', { userId, slug: site.slug });
    return { sent: true };
  } catch (err) {
    logger.error('[Notify] Échec notification hot lead', { userId, error: err.message });
    return { skipped: true, reason: err.message };
  }
}

/**
 * Rappel de SLA : un prospect chaud non traité depuis plus d'1 heure
 * (pipeline toujours 'rappeler') déclenche UN rappel au propriétaire.
 * Appelé par le sequenceWorker à chaque tick (30 min).
 */
export async function remindStaleHotLeads() {
  if (!smtpPool.isConfigured) return { reminded: 0 };

  const stale = await staleHotLeads();

  let reminded = 0;
  for (const row of stale) {
    try {
      const owner = await repo.users.findById(row.user_id);
      if (!owner?.email) continue;

      let meta = {};
      try { meta = JSON.parse(row.meta || '{}'); } catch {}
      const phone = meta.phone || row.phone || '';

      await smtpPool.send({
        to:      owner.email,
        subject: `⏰ Prospect chaud non rappelé — ${row.lead_name}`,
        text:
`Le prospect "${meta.name || row.lead_name}" a rempli le formulaire il y a plus d'une heure et n'a toujours pas été rappelé.
${phone ? `Téléphone : ${phone}` : ''}
Dashboard : ${config.server.baseUrl}/dashboard.html

Chaque heure qui passe divise les chances de conversion.`,
        html: `
<div style="font-family:Arial,sans-serif;font-size:14px;color:#222;max-width:520px;line-height:1.6">
  <p style="font-size:16px"><strong>⏰ Prospect chaud en attente depuis +1h</strong></p>
  <p><strong>${sanitize(meta.name || row.lead_name)}</strong> (démo « ${sanitize(row.lead_name)} ») attend votre rappel.</p>
  ${phone ? `<p>📞 <a href="tel:${sanitize(phone)}" style="font-size:18px;font-weight:bold">${sanitize(phone)}</a></p>` : ''}
  <p><a href="${config.server.baseUrl}/dashboard.html" style="color:#2563eb">Ouvrir le dashboard →</a></p>
  <p style="color:#888;font-size:12px">Chaque heure qui passe divise les chances de conversion.</p>
</div>`,
      });

      // Marqueur : un seul rappel par prospect chaud
      await markHotLeadReminded(row.lead_id, row.user_id);

      reminded++;
    } catch (err) {
      logger.error('[Notify] Rappel SLA échoué', { leadId: row.lead_id, error: err.message });
    }
  }

  if (reminded) logger.info(`[Notify] ${reminded} rappel(s) SLA prospect chaud envoyé(s)`);
  return { reminded };
}
