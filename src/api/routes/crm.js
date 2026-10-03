/**
 * routes/crm.js — Actions CRM depuis l'email de notification « prospect chaud ».
 * Public mais protégé par token HMAC signé + expirant (7 jours).
 *
 * Deux temps, volontairement :
 *   GET  /crm/quick/:token → page de confirmation, AUCUNE écriture ;
 *   POST /crm/quick/:token → applique l'action.
 *
 * Les passerelles de sécurité de messagerie (Outlook Safe Links, Mimecast,
 * Proofpoint…) visitent tous les liens d'un email avant l'utilisateur. Quand
 * le GET écrivait, les trois boutons (converti, rappelé, perdu) étaient
 * « cliqués » d'office et le statut final du lead dépendait de l'ordre de
 * leur visite. Un scanner suit les liens, il ne soumet pas de formulaire.
 */
import express from 'express';
import { verifyCrmToken } from '../../utils/crmToken.js';
import { repo }     from '../../db/repo.js';
import { sanitize } from '../../utils/utils.js';
import { logger }   from '../../utils/logger.js';
import { reportError } from '../../utils/errorReporter.js';

const router = express.Router();

const ACTIONS = {
  converti: { ask: 'Marquer ce prospect comme client converti ?', confirm: '✅ Oui, converti',      done: '✅ Client converti — bravo !' },
  contacte: { ask: 'Marquer ce prospect comme rappelé ?',         confirm: '☎️ Oui, rappelé',       done: '☎️ Marqué comme rappelé' },
  rappeler: { ask: 'Garder ce prospect dans « à rappeler » ?',    confirm: '📵 Oui, à rappeler',     done: '📵 Gardé dans « à rappeler »' },
  perdu:    { ask: 'Marquer ce prospect comme perdu ?',           confirm: '❌ Oui, perdu',          done: '❌ Marqué comme perdu' },
};

// Page autonome : styles inline uniquement, aucun script.
const PAGE_CSP = [
  "default-src 'none'",
  "style-src 'unsafe-inline'",
  "form-action 'self'",
  "base-uri 'none'",
  "frame-ancestors 'none'",
].join('; ');

const BUTTON = 'display:inline-block;margin-top:20px;border:0;cursor:pointer;color:#fff;'
             + 'padding:10px 22px;border-radius:8px;text-decoration:none;font-size:14px';

/** `title` et `body` doivent être déjà échappés par l'appelant. */
function page(title, body, { ok = true, action = '' } = {}) {
  return `<!DOCTYPE html><html lang="fr"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex">
<title>AutoDemo — CRM</title></head>
<body style="font-family:system-ui,sans-serif;background:#0c0d11;color:#e2e4f0;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0">
  <div style="text-align:center;padding:40px;max-width:420px">
    <div style="font-size:42px;margin-bottom:16px">${ok ? '✓' : '✗'}</div>
    <h1 style="font-size:20px;margin:0 0 8px">${title}</h1>
    <p style="color:#6b7294;font-size:14px">${body}</p>
    ${action}
    <a href="/dashboard.html" style="${BUTTON};background:#2a2d3a">Ouvrir le dashboard</a>
  </div>
</body></html>`;
}

function send(res, status, html) {
  res.setHeader('Content-Security-Policy', PAGE_CSP);
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  res.status(status).send(html);
}

/** Vérifie le token et charge le lead. Renvoie null après avoir répondu. */
async function resolve(req, res) {
  const parsed = verifyCrmToken(req.params.token);
  if (!parsed) {
    send(res, 400, page('Lien invalide ou expiré',
      'Ce lien d\'action a expiré (7 jours) ou a été altéré. Utilisez le dashboard.', { ok: false }));
    return null;
  }
  const lead = await repo.leads.findById(parsed.leadId);
  if (!lead) {
    send(res, 404, page('Lead introuvable', 'Ce prospect a peut-être été supprimé.', { ok: false }));
    return null;
  }
  return { action: parsed.action, lead };
}

function fail(res, err, context) {
  logger.error(`[CRM] ${context}`, { error: err.message });
  reportError(`CRM ${context}`, err);
  send(res, 500, page('Erreur', 'L\'action n\'a pas pu être traitée. Réessayez depuis le dashboard.', { ok: false }));
}

router.get('/quick/:token', async (req, res) => {
  try {
    const target = await resolve(req, res);
    if (!target) return;
    const { action, lead } = target;

    const form = `<form method="post" action="/crm/quick/${encodeURIComponent(req.params.token)}">
      <button type="submit" style="${BUTTON};background:#5b8cf5">${ACTIONS[action].confirm}</button>
    </form>`;
    send(res, 200, page(sanitize(ACTIONS[action].ask), `Prospect : « ${sanitize(lead.name)} »`, { action: form }));
  } catch (err) {
    fail(res, err, 'Confirmation');
  }
});

router.post('/quick/:token', async (req, res) => {
  try {
    const target = await resolve(req, res);
    if (!target) return;
    const { action, lead } = target;

    await repo.leads.updateCrm(lead.id, { pipeline: action });
    logger.info('[CRM] Action un-clic', { leadId: lead.id, action });
    send(res, 200, page(sanitize(ACTIONS[action].done), `Statut de « ${sanitize(lead.name)} » mis à jour.`));
  } catch (err) {
    fail(res, err, 'Action');
  }
});

export default router;
