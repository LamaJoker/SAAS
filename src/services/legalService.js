/**
 * legalService.js — Pages légales générées depuis la config (FR).
 *
 * Mentions légales, politique de confidentialité (RGPD), CGV.
 * ⚠️ Modèles de base : un bandeau invite à les faire valider par un juriste.
 * Les champs manquants apparaissent en « [À COMPLÉTER] ».
 */
import { config } from '../config/config.js';

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const val = (v) => (v && String(v).trim()) ? esc(v) : '<span style="color:#b91c1c">[À COMPLÉTER]</span>';

function isComplete() {
  const l = config.legal;
  return !!(l.address && l.siret && l.email && l.hosting);
}

function layout(title, body) {
  const banner = isComplete() ? '' : `
    <div style="background:#fef3c7;border:1px solid #f59e0b;color:#92400e;padding:12px 16px;border-radius:8px;margin-bottom:24px;font-size:13px">
      ⚠️ Modèle à compléter et à faire valider par un juriste avant exploitation.
      Renseignez les variables <code>BILLING_SELLER_*</code> / <code>LEGAL_*</code>.
    </div>`;
  return `<!DOCTYPE html><html lang="fr"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)} — ${esc(config.legal.company)}</title>
<style>
  body{font-family:system-ui,-apple-system,Arial,sans-serif;color:#1a1a1a;max-width:760px;margin:40px auto;padding:0 24px;line-height:1.65;font-size:15px}
  h1{font-size:26px;margin-bottom:8px} h2{font-size:18px;margin-top:28px}
  a{color:#2563eb} .muted{color:#666;font-size:13px}
  footer{margin-top:48px;border-top:1px solid #eee;padding-top:16px;font-size:12px;color:#888}
</style></head><body>
  ${banner}
  <h1>${esc(title)}</h1>
  ${body}
  <footer>${esc(config.legal.company)} — document généré le ${new Date().toLocaleDateString('fr-FR')}.
    <a href="/legal">Toutes les pages légales</a></footer>
</body></html>`;
}

export function renderIndex() {
  return layout('Informations légales', `
    <ul>
      <li><a href="/legal/mentions">Mentions légales</a></li>
      <li><a href="/legal/confidentialite">Politique de confidentialité (RGPD)</a></li>
      <li><a href="/legal/cgv">Conditions générales de vente</a></li>
    </ul>`);
}

export function renderMentions() {
  const l = config.legal;
  return layout('Mentions légales', `
    <h2>Éditeur du site</h2>
    <p>
      <strong>${val(l.company)}</strong>${l.legalForm ? ` — ${esc(l.legalForm)}` : ''}
      ${l.capital ? `<br>Capital social : ${esc(l.capital)}` : ''}
      <br>Siège : ${val(l.address)}
      <br>SIRET : ${val(l.siret)}${l.rcs ? ` · RCS : ${esc(l.rcs)}` : ''}
      ${l.vat ? `<br>TVA intracommunautaire : ${esc(l.vat)}` : ''}
      <br>Contact : ${val(l.email)}
      ${l.director ? `<br>Directeur de la publication : ${esc(l.director)}` : ''}
    </p>
    <h2>Hébergement</h2>
    <p>${val(l.hosting)}</p>
    <h2>Propriété intellectuelle</h2>
    <p>L'ensemble des contenus de ce site est protégé. Toute reproduction sans
    autorisation est interdite.</p>`);
}

export function renderPrivacy() {
  const l = config.legal;
  const contact = l.dpoEmail || l.email;
  return layout('Politique de confidentialité', `
    <p class="muted">Conforme au RGPD (Règlement UE 2016/679).</p>
    <h2>Responsable du traitement</h2>
    <p>${val(l.company)} — ${val(l.address)}. Contact : ${val(contact)}.</p>
    <h2>Données collectées</h2>
    <p>Compte (email, nom), données de prospection saisies/importées par
    l'utilisateur (entreprises, contacts), données de paiement (via Stripe, non
    stockées sur nos serveurs), journaux techniques.</p>
    <h2>Finalités &amp; base légale</h2>
    <p>Fourniture du service (exécution du contrat), facturation (obligation
    légale), prospection commerciale de l'utilisateur envers ses propres
    prospects (intérêt légitime de l'utilisateur, qui en est responsable).</p>
    <h2>Durée de conservation</h2>
    <p>Données de compte : pendant la vie du compte. Factures : 10 ans (obligation
    comptable). Journaux : selon la rétention configurée.</p>
    <h2>Vos droits</h2>
    <p>Accès, rectification, effacement, <strong>portabilité</strong>, opposition.
    Le compte permet l'export de vos données (portabilité) et la suppression
    définitive (effacement) depuis l'onglet « Compte ». Pour toute demande :
    ${val(contact)}. Réclamation possible auprès de la CNIL (cnil.fr).</p>
    <h2>Cookies</h2>
    <p>Seul un cookie d'authentification strictement nécessaire (HttpOnly) est
    utilisé — exempt de consentement. Aucun cookie publicitaire ou de pistage.</p>`);
}

export function renderCGV() {
  const l = config.legal;
  return layout('Conditions générales de vente', `
    <h2>1. Objet</h2>
    <p>Les présentes régissent la vente d'accès au service ${esc(l.company)}
    (génération de sites de démonstration et outils de prospection).</p>
    <h2>2. Prix</h2>
    <p>Prix indiqués en euros. Le taux de TVA applicable figure sur la facture
    (autoliquidation pour les clients professionnels UE disposant d'un numéro de
    TVA valide).</p>
    <h2>3. Crédits &amp; abonnements</h2>
    <p>Les crédits sont consommés à chaque génération. Les abonnements sont
    mensuels, à reconduction tacite, résiliables à tout moment depuis le portail
    client ; la résiliation prend effet à la fin de la période en cours.</p>
    <h2>4. Paiement</h2>
    <p>Paiement sécurisé via Stripe. Une facture est émise à chaque paiement.</p>
    <h2>5. Droit de rétractation</h2>
    <p>Pour les professionnels, le droit de rétractation ne s'applique pas. Le
    service étant fourni immédiatement, le client renonce à la rétractation pour
    les contenus numériques exécutés sans délai.</p>
    <h2>6. Responsabilité</h2>
    <p>L'utilisateur est seul responsable de la licéité de sa prospection
    (consentement, intérêt légitime, ciblage B2B). ${esc(l.company)} fournit un
    outil, non une base de données de prospects.</p>
    <h2>7. Droit applicable</h2>
    <p>Droit français. Tout litige relève des tribunaux compétents du siège de
    l'éditeur, à défaut de résolution amiable.</p>`);
}
