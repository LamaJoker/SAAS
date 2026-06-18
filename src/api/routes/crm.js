/**
 * routes/crm.js — Actions CRM en un clic depuis l'email de notification.
 * Public mais protégé par token HMAC signé + expirant (7 jours).
 */
import express from 'express';
import { verifyCrmToken } from '../../utils/crmToken.js';
import { repo }   from '../../db/repo.js';
import { logger } from '../../utils/logger.js';

const router = express.Router();

const LABELS = {
  converti: '✅ Client converti — bravo !',
  contacte: '☎️ Marqué comme rappelé',
  rappeler: '📵 Gardé dans "à rappeler"',
  perdu:    '❌ Marqué comme perdu',
};

function page(title, body, ok = true) {
  return `<!DOCTYPE html><html lang="fr"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>AutoDemo — CRM</title></head>
<body style="font-family:system-ui,sans-serif;background:#0c0d11;color:#e2e4f0;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0">
  <div style="text-align:center;padding:40px;max-width:420px">
    <div style="font-size:42px;margin-bottom:16px">${ok ? '✓' : '✗'}</div>
    <h1 style="font-size:20px;margin:0 0 8px">${title}</h1>
    <p style="color:#6b7294;font-size:14px">${body}</p>
    <a href="/dashboard.html" style="display:inline-block;margin-top:20px;background:#5b8cf5;color:#fff;padding:10px 22px;border-radius:8px;text-decoration:none;font-size:14px">Ouvrir le dashboard</a>
  </div>
</body></html>`;
}

router.get('/quick/:token', async (req, res) => {
  const parsed = verifyCrmToken(req.params.token);
  if (!parsed) {
    return res.status(400).send(page('Lien invalide ou expiré',
      'Ce lien d\'action a expiré (7 jours) ou a été altéré. Utilisez le dashboard.', false));
  }

  const lead = await repo.leads.findById(parsed.leadId);
  if (!lead) {
    return res.status(404).send(page('Lead introuvable',
      'Ce prospect a peut-être été supprimé.', false));
  }

  await repo.leads.updateCrm(lead.id, { pipeline: parsed.action });
  logger.info('[CRM] Action un-clic', { leadId: lead.id, action: parsed.action });

  res.send(page(LABELS[parsed.action], `Statut de « ${lead.name} » mis à jour.`));
});

export default router;
