/**
 * usage.js — Journalisation des appels au modèle et agrégats de coût.
 *
 * L'enregistrement ne doit JAMAIS faire échouer une génération : une écriture
 * de télémétrie ratée est un problème d'observabilité, pas de production. Toutes
 * les erreurs sont donc absorbées et loggées.
 */
import { randomUUID } from 'node:crypto';
import { getDb } from '../db/database.js';
import { logger } from '../utils/logger.js';
import { estimateCost } from './cost.js';

/**
 * @param {object} call
 * @param {string} call.model
 * @param {string} call.promptVersion
 * @param {string} call.outcome   ok | repaired | failed | mock
 * @param {number} [call.tokensIn]
 * @param {number} [call.tokensOut]
 * @param {number} [call.durationMs]
 * @param {number} [call.attempt]
 * @param {string[]} [call.fallbacks]
 * @param {string} [call.userId]
 * @param {string} [call.leadId]
 * @returns {{ cents: number, known: boolean } | null}
 */
export function recordAiCall(call) {
  const {
    model, promptVersion, outcome,
    tokensIn = 0, tokensOut = 0, durationMs = null,
    attempt = 1, fallbacks = [], userId = null, leadId = null,
  } = call;

  const cost = estimateCost(model, tokensIn, tokensOut);

  try {
    getDb().prepare(`
      INSERT INTO ai_calls
        (id, user_id, lead_id, model, prompt_version, tokens_in, tokens_out,
         cost_cents, cost_known, duration_ms, attempt, outcome, fallbacks)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
    `).run(
      randomUUID(), userId, leadId, model, promptVersion, tokensIn, tokensOut,
      cost.cents, cost.known ? 1 : 0, durationMs, attempt, outcome,
      fallbacks.length ? fallbacks.join(',') : null
    );
  } catch (err) {
    // Volontairement non bloquant : perdre une ligne de télémétrie ne doit pas
    // coûter une génération déjà payée par un crédit.
    logger.warn('[IA] Journalisation de l\'appel échouée', { error: err.message });
  }

  return cost;
}

/**
 * Agrégats sur une fenêtre glissante, pour /health/details et le dashboard.
 *
 * @param {number} [days]
 * @param {string|null} [userId] limite à un compte
 */
export function aiUsageSummary(days = 30, userId = null) {
  const where = userId
    ? "WHERE created_at >= datetime('now', ?) AND user_id = ?"
    : "WHERE created_at >= datetime('now', ?)";
  const params = userId ? [`-${parseInt(days, 10)} days`, userId] : [`-${parseInt(days, 10)} days`];

  try {
    const row = getDb().prepare(`
      SELECT COUNT(*)                                    AS calls,
             COALESCE(SUM(tokens_in), 0)                 AS tokens_in,
             COALESCE(SUM(tokens_out), 0)                AS tokens_out,
             COALESCE(SUM(cost_cents), 0)                AS cost_cents,
             SUM(CASE WHEN cost_known = 0 THEN 1 ELSE 0 END) AS unpriced,
             SUM(CASE WHEN outcome = 'failed'   THEN 1 ELSE 0 END) AS failed,
             SUM(CASE WHEN outcome = 'repaired' THEN 1 ELSE 0 END) AS repaired,
             SUM(CASE WHEN attempt > 1 THEN 1 ELSE 0 END)          AS retries
        FROM ai_calls ${where}
    `).get(...params);

    const calls = row?.calls ?? 0;
    return {
      days,
      calls,
      tokensIn:  row?.tokens_in ?? 0,
      tokensOut: row?.tokens_out ?? 0,
      costCents: Math.round((row?.cost_cents ?? 0) * 1e4) / 1e4,
      // Le chiffre qui décide de la marge : ce que coûte une génération vendue.
      costPerCallCents: calls ? Math.round((row.cost_cents / calls) * 1e4) / 1e4 : 0,
      unpricedCalls: row?.unpriced ?? 0,
      failed:   row?.failed ?? 0,
      repaired: row?.repaired ?? 0,
      retries:  row?.retries ?? 0,
    };
  } catch (err) {
    logger.warn('[IA] Agrégat d\'usage indisponible', { error: err.message });
    return null;
  }
}
