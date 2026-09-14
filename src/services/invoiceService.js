/**
 * invoiceService.js — Factures légales (numérotation séquentielle + TVA).
 *
 * Modèle : le prix configuré est le montant débité (TTC). La TVA est calculée
 * selon la situation de l'acheteur :
 *   - même pays que le vendeur            → taux domestique (FR : 20 %)
 *   - autre pays UE AVEC n° TVA valide     → autoliquidation (0 %, art. 283 CGI)
 *   - autre pays UE SANS n° TVA            → taux domestique (B2C, simplifié)
 *   - hors UE                              → exonération export (0 %, art. 262 ter)
 *
 * ⚠️ Modèle simplifié : adaptez à votre régime (OSS, franchise en base…) avec
 *    votre comptable. computeVat est pur et testé.
 */
import { getDb }   from '../db/database.js';
import { config }  from '../config/config.js';
import { randomUUID } from 'crypto';

export const EU_COUNTRIES = new Set([
  'AT','BE','BG','HR','CY','CZ','DK','EE','FI','FR','DE','GR','HU','IE','IT',
  'LV','LT','LU','MT','NL','PL','PT','RO','SK','SI','ES','SE',
]);

const REVERSE_CHARGE_NOTE = 'TVA non applicable — autoliquidation par le preneur (art. 283-2 du CGI).';
const EXPORT_NOTE         = 'TVA non applicable — exonération (art. 262 ter / 259 B du CGI).';

/**
 * Calcule la ventilation TVA d'un montant TTC (centimes). Pur, testable.
 * @returns {{ rate:number, ht:number, vat:number, ttc:number, note:string }}
 */
export function computeVat({ amountTtc, sellerCountry = 'FR', buyerCountry = null, buyerVat = null, defaultRate = 20 }) {
  const ttc = Math.round(amountTtc);
  let rate = defaultRate;
  let note = '';

  if (buyerCountry && buyerCountry !== sellerCountry) {
    if (EU_COUNTRIES.has(buyerCountry)) {
      if (buyerVat && String(buyerVat).trim()) { rate = 0; note = REVERSE_CHARGE_NOTE; }
      // sinon : B2C intra-UE → taux domestique (simplification)
    } else {
      rate = 0; note = EXPORT_NOTE; // hors UE
    }
  }

  if (rate === 0) return { rate: 0, ht: ttc, vat: 0, ttc, note };
  const ht  = Math.round(ttc / (1 + rate / 100));
  return { rate, ht, vat: ttc - ht, ttc, note };
}

/** Numéro séquentiel gap-free par année : FACT-2026-0001. */
function nextInvoiceNumber(db, year) {
  const n = db.prepare("SELECT COUNT(*) AS c FROM invoices WHERE number LIKE ?").get(`FACT-${year}-%`).c;
  return `FACT-${year}-${String(n + 1).padStart(4, '0')}`;
}

/**
 * Crée une facture figée pour un paiement. Numéro + insertion dans UNE
 * transaction (numérotation sans trou ni doublon).
 */
export function createInvoice({ user, type, description, amountTtc, currency = 'eur', stripeRef = null }) {
  const db   = getDb();
  const v    = computeVat({
    amountTtc,
    sellerCountry: config.billing.seller.country,
    buyerCountry:  user.billing_country,
    buyerVat:      user.vat_number,
    defaultRate:   config.billing.vatRate,
  });
  const id   = randomUUID();
  const year = new Date().getFullYear();

  const tx = db.transaction(() => {
    const number = nextInvoiceNumber(db, year);
    db.prepare(`
      INSERT INTO invoices
        (id, number, user_id, type, description, currency,
         amount_ht, vat_rate, vat_amount, amount_ttc, vat_note,
         buyer_name, buyer_address, buyer_country, buyer_vat, stripe_ref)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `).run(
      id, number, user.id, type, description, currency,
      v.ht, v.rate, v.vat, v.ttc, v.note,
      user.billing_name || user.name || user.email,
      user.billing_address || '', user.billing_country || '', user.vat_number || '',
      stripeRef
    );
    return number;
  });

  tx();  // la valeur de retour (le numéro) n'est pas utilisée ici
  return db.prepare('SELECT * FROM invoices WHERE id = ?').get(id);
}

export function listInvoices(userId) {
  return getDb().prepare('SELECT * FROM invoices WHERE user_id = ? ORDER BY issued_at DESC').all(userId);
}

export function getInvoiceForUser(id, userId) {
  return getDb().prepare('SELECT * FROM invoices WHERE id = ? AND user_id = ?').get(id, userId);
}

const eur = (cents) => (cents / 100).toFixed(2) + ' €';
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Rend une facture en HTML imprimable (le navigateur exporte en PDF). */
export function renderInvoiceHTML(inv) {
  const s = config.billing.seller;
  const dateFr = new Date(inv.issued_at + 'Z').toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' });
  const vatLine = inv.vat_rate > 0
    ? `<tr><td>TVA (${inv.vat_rate} %)</td><td style="text-align:right">${eur(inv.vat_amount)}</td></tr>`
    : `<tr><td>TVA</td><td style="text-align:right">0,00 €</td></tr>`;

  return `<!DOCTYPE html><html lang="fr"><head><meta charset="utf-8">
<title>Facture ${esc(inv.number)}</title>
<style>
  body{font-family:system-ui,Arial,sans-serif;color:#1a1a1a;max-width:760px;margin:30px auto;padding:0 24px;font-size:14px;line-height:1.5}
  .head{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:40px}
  h1{font-size:26px;margin:0 0 4px} .muted{color:#666;font-size:13px}
  .parties{display:flex;justify-content:space-between;gap:40px;margin-bottom:32px}
  .box{flex:1} .box h3{font-size:11px;text-transform:uppercase;letter-spacing:.08em;color:#888;margin:0 0 6px}
  table{width:100%;border-collapse:collapse;margin-top:12px}
  th,td{padding:10px 8px;border-bottom:1px solid #eee;text-align:left}
  th{font-size:11px;text-transform:uppercase;color:#888}
  .totals{margin-top:18px;margin-left:auto;width:280px}
  .totals td{border:none;padding:6px 8px} .ttc{font-weight:700;font-size:16px;border-top:2px solid #1a1a1a}
  .note{margin-top:24px;padding:12px;background:#f6f6f6;border-radius:8px;font-size:12px;color:#555}
  @media print{body{margin:0}.noprint{display:none}}
  .btn{display:inline-block;margin-top:24px;background:#5b8cf5;color:#fff;padding:10px 20px;border-radius:8px;text-decoration:none}
</style></head><body>
  <div class="head">
    <div><h1>${esc(s.name)}</h1>
      <div class="muted">${esc(s.address)}</div>
      ${s.siret ? `<div class="muted">SIRET : ${esc(s.siret)}</div>` : ''}
      ${s.vat ? `<div class="muted">TVA : ${esc(s.vat)}</div>` : ''}
    </div>
    <div style="text-align:right">
      <h1 style="font-size:20px">FACTURE</h1>
      <div class="muted">${esc(inv.number)}</div>
      <div class="muted">${dateFr}</div>
    </div>
  </div>

  <div class="parties">
    <div class="box"><h3>Émetteur</h3>${esc(s.name)}<br>${esc(s.address)}</div>
    <div class="box"><h3>Client</h3>${esc(inv.buyer_name)}<br>${esc(inv.buyer_address)}
      ${inv.buyer_country ? `<br>${esc(inv.buyer_country)}` : ''}
      ${inv.buyer_vat ? `<br>TVA : ${esc(inv.buyer_vat)}` : ''}</div>
  </div>

  <table>
    <thead><tr><th>Description</th><th style="text-align:right">Montant HT</th></tr></thead>
    <tbody><tr><td>${esc(inv.description)}</td><td style="text-align:right">${eur(inv.amount_ht)}</td></tr></tbody>
  </table>

  <table class="totals">
    <tr><td>Total HT</td><td style="text-align:right">${eur(inv.amount_ht)}</td></tr>
    ${vatLine}
    <tr class="ttc"><td>Total TTC</td><td style="text-align:right">${eur(inv.amount_ttc)}</td></tr>
  </table>

  ${inv.vat_note ? `<div class="note">${esc(inv.vat_note)}</div>` : ''}
  <a href="#" class="btn noprint" onclick="window.print();return false">Imprimer / PDF</a>
</body></html>`;
}
