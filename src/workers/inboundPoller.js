/**
 * inboundPoller.js — Poller IMAP optionnel pour les réponses entrantes.
 *
 * Alternative au webhook /inbound quand le fournisseur mail n'expose pas
 * d'inbound parse. Activable : INBOUND_ENABLED=true + IMAP_HOST/USER/PASS.
 * Dépendance chargée paresseusement : npm i imapflow (dormant sinon).
 */
import { handleInboundEmail } from '../services/inboundService.js';
import { config } from '../config/config.js';
import { logger } from '../utils/logger.js';

let timer = null;
let running = false;

async function pollOnce(ImapFlow) {
  const { host, port, user, pass } = config.features.inbound.imap;
  const client = new ImapFlow({ host, port, secure: true, auth: { user, pass }, logger: false });
  await client.connect();
  try {
    const lock = await client.getMailboxLock('INBOX');
    try {
      // Messages non lus uniquement
      for await (const msg of client.fetch({ seen: false }, { envelope: true, source: true })) {
        const from    = msg.envelope?.from?.[0]?.address || '';
        const subject = msg.envelope?.subject || '';
        // 8 000 : la partie message/delivery-status d'un rebond arrive après
        // les en-têtes et le corps lisible ; 2 000 la tronquait systématiquement.
        const text    = msg.source ? msg.source.toString('utf8').slice(0, 8000) : '';
        await handleInboundEmail({ from, subject, text });
        await client.messageFlagsAdd(msg.uid, ['\\Seen'], { uid: true });
      }
    } finally {
      lock.release();
    }
  } finally {
    await client.logout().catch(() => {});
  }
}

export async function startInboundPoller() {
  const { enabled, imap } = config.features.inbound;
  if (!enabled || !imap.host || !imap.user || !imap.pass) return false;

  let ImapFlow;
  try {
    ({ ImapFlow } = await import('imapflow'));
  } catch {
    logger.warn('[InboundPoller] imapflow non installé — npm i imapflow (poller désactivé)');
    return false;
  }

  const intervalMs = Math.max(30, imap.pollSeconds) * 1000;
  logger.info(`[InboundPoller] Démarré (IMAP ${imap.host}, ${imap.pollSeconds}s)`);

  const tick = async () => {
    if (running) return;
    running = true;
    try { await pollOnce(ImapFlow); }
    catch (err) { logger.warn('[InboundPoller] Poll échoué', { error: err.message }); }
    finally { running = false; }
  };

  tick();
  timer = setInterval(tick, intervalMs);
  timer.unref();
  return true;
}

export function stopInboundPoller() {
  if (timer) clearInterval(timer);
  timer = null;
}
