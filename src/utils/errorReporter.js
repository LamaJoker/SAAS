/**
 * errorReporter.js — Alerte sur erreur critique vers un webhook (Slack/Discord/…).
 *
 * Activable : ERROR_WEBHOOK_URL. Dormant sinon (les erreurs restent loggées en
 * fichier par le logger). Throttle pour ne pas noyer le canal en cas de boucle.
 */
import { logger } from './logger.js';

const WEBHOOK = process.env.ERROR_WEBHOOK_URL || '';
const THROTTLE_MS = parseInt(process.env.ERROR_WEBHOOK_THROTTLE_MS || '60000');
const lastSent = new Map(); // clé message → timestamp

export function reportError(context, err) {
  if (!WEBHOOK) return;
  const key = `${context}:${err?.message ?? err}`.slice(0, 120);
  const now = Date.now();
  if (now - (lastSent.get(key) ?? 0) < THROTTLE_MS) return;
  lastSent.set(key, now);

  const text = `🚨 *AutoDemo* [${process.env.NODE_ENV || 'dev'}] — ${context}\n` +
               `${err?.message ?? err}\n\`\`\`${(err?.stack ?? '').slice(0, 800)}\`\`\``;

  // Fire-and-forget : l'alerte ne doit jamais bloquer ni relancer une erreur
  fetch(WEBHOOK, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, content: text }), // text=Slack, content=Discord
    signal: AbortSignal.timeout(5000),
  }).catch(e => logger.warn('[ErrorReporter] Envoi alerte échoué', { error: e.message }));
}

/**
 * Branche les gardes de processus : une exception non capturée ou une promesse
 * rejetée est tracée + alertée avant tout arrêt, au lieu de tuer l'app en silence.
 */
export function installProcessGuards() {
  process.on('unhandledRejection', (reason) => {
    logger.error('unhandledRejection', { reason: reason?.message ?? String(reason), stack: reason?.stack });
    reportError('unhandledRejection', reason instanceof Error ? reason : new Error(String(reason)));
  });

  process.on('uncaughtException', (err) => {
    logger.error('uncaughtException', { message: err.message, stack: err.stack });
    reportError('uncaughtException', err);
    // Une exception non capturée laisse le process dans un état indéterminé :
    // on alerte, on laisse le temps au flush, puis on sort (le superviseur relance).
    setTimeout(() => process.exit(1), 1000).unref();
  });
}
