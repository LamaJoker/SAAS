/**
 * cost.js — Estimation du coût d'un appel au modèle.
 *
 * Pourquoi c'est nécessaire
 * ─────────────────────────
 * L'IA est le premier poste de coût variable du produit : un crédit vendu doit
 * couvrir la génération qu'il paie. Sans mesure, on ne sait pas si l'unité
 * économique tient, et on le découvre sur la facture du fournisseur plutôt que
 * dans le tableau de bord.
 *
 * Les tarifs sont en centimes d'euro par million de tokens, et ils bougent.
 * Ils sont donc isolés ici, datés, et surchargeables par AI_PRICE_IN /
 * AI_PRICE_OUT pour un modèle absent de la table — plutôt que de renvoyer
 * silencieusement zéro, ce qui donnerait une fausse impression de gratuité.
 */

/** Tarifs indicatifs, en centimes d'euro par million de tokens. MAJ 2026-05. */
export const PRICING = {
  'gpt-4o-mini':      { in: 15,   out: 60 },
  'gpt-4o':           { in: 250,  out: 1000 },
  'gpt-4.1-mini':     { in: 40,   out: 160 },
  'claude-haiku-4-5': { in: 100,  out: 500 },
  'claude-sonnet-4-5':{ in: 300,  out: 1500 },
};

/**
 * Coût estimé d'un appel, en centimes d'euro.
 *
 * @param {string} model
 * @param {number} tokensIn
 * @param {number} tokensOut
 * @returns {{ cents: number, known: boolean }} `known` à false quand le tarif
 *   est inconnu : l'appelant peut alors afficher « coût non estimé » au lieu
 *   d'afficher 0,00 € et de croire que la génération est gratuite.
 */
export function estimateCost(model, tokensIn = 0, tokensOut = 0) {
  const envIn  = parseFloat(process.env.AI_PRICE_IN ?? '');
  const envOut = parseFloat(process.env.AI_PRICE_OUT ?? '');
  const hasEnv = Number.isFinite(envIn) && Number.isFinite(envOut);

  const rate = PRICING[model] ?? (hasEnv ? { in: envIn, out: envOut } : null);
  if (!rate) return { cents: 0, known: false };

  const cents = (tokensIn / 1e6) * rate.in + (tokensOut / 1e6) * rate.out;
  return { cents: Math.round(cents * 1e6) / 1e6, known: true };
}

/** Formate des centimes en euros lisibles (les montants sont minuscules). */
export function formatCents(cents) {
  if (cents >= 100) return `${(cents / 100).toFixed(2)} €`;
  if (cents >= 1)   return `${cents.toFixed(2)} c€`;
  return `${(cents * 10).toFixed(2)} millic€`;
}
