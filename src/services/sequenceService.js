/**
 * sequenceService.js — Séquence email automatique + scoring leads
 *
 * Séquence :
 *   J0 → premier contact (variante A/B)
 *   J+3 → relance si pas d'ouverture
 *   J+7 → dernier message si pas de clic
 *
 * Scoring lead (0-100) :
 *   +30 si créé < 24h
 *   +20 si a un téléphone
 *   +15 si activité haute valeur
 *   +10 si note Google >= 4.5
 *   +10 si pas de site web
 *   +5  si email valide
 *
 * Usage : appelé par un cron ou un worker périodique
 */

import { getDb }            from '../db/database.js';
import { smtpManager }      from './smtpManager.js';
import { createTrackingPixel, wrapLink } from './trackingService.js';
import { Site }             from '../db/models/Site.js';
import { Lead }             from '../db/models/Lead.js';
import { logger }           from '../utils/logger.js';
import { randomBytes }      from 'crypto';
import { config }           from '../config/config.js';

// ─── Lead scoring ─────────────────────────────────────────────────────────────
const HIGH_VALUE_ACTIVITIES = [
  'plombier', 'électricien', 'couvreur', 'maçon', 'dentiste',
  'médecin', 'avocat', 'notaire', 'garagiste', 'chauffagiste',
  'expert-comptable', 'architecte', 'kinésithérapeute',
];

export function scoreLead(lead, site) {
  let score = 0;
  const ageDays = (Date.now() - new Date(lead.created_at).getTime()) / 86_400_000;
  const activity = (lead.activity || '').toLowerCase();

  if (ageDays < 1)   score += 30;
  else if (ageDays < 3) score += 15;
  else if (ageDays < 7) score += 5;

  if (lead.phone)  score += 20;
  if (lead.email && lead.email.includes('@'))  score += 5;

  if (HIGH_VALUE_ACTIVITIES.some(a => activity.includes(a))) score += 15;
  if ((lead.rating || 0) >= 4.5)  score += 10;
  if (!lead.website || lead.website === '') score += 10;

  if (site?.views > 0) score -= 5; // déjà vu = moins urgent

  return Math.min(100, Math.max(0, score));
}

// ─── Sequence state ───────────────────────────────────────────────────────────
function ensureSequenceSchema() {
  getDb().exec(`
    CREATE TABLE IF NOT EXISTS email_sequence (
      id          TEXT PRIMARY KEY,
      site_id     TEXT NOT NULL,
      lead_id     TEXT NOT NULL,
      step        INTEGER NOT NULL DEFAULT 0,
      status      TEXT NOT NULL DEFAULT 'pending',  -- pending | sent | done | unsubscribed
      next_send_at TEXT,
      last_sent_at TEXT,
      score        INTEGER DEFAULT 0,
      created_at   TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_seq_next ON email_sequence(next_send_at, status);
    CREATE INDEX IF NOT EXISTS idx_seq_lead ON email_sequence(lead_id);
  `);
}

// ─── Email templates ──────────────────────────────────────────────────────────
const STEPS = [
  {
    step:    0,
    delay:   0,   // immédiat
    subject: ({ name }) => `J'ai fait quelque chose pour ${name}`,
    variant: 'step0_curiosite',
    text: ({ name, city, url, sender }) =>
`Bonjour,

J'ai créé quelque chose pour vous : ${url}

C'est un site pour ${name} à ${city}. Prenez 30 secondes pour regarder.

Si ça vous intéresse, répondez-moi directement.

${sender}`,
    html: ({ name, city, pixelHtml, trackedUrl, sender }) => `
<div style="font-family:Arial,sans-serif;font-size:14px;color:#111;max-width:520px;line-height:1.7">
  <p>Bonjour,</p>
  <p>J'ai créé quelque chose pour vous :</p>
  <p style="margin:20px 0">
    <a href="${trackedUrl}" style="background:#2563eb;color:#fff;padding:12px 26px;border-radius:6px;text-decoration:none;font-weight:bold;display:inline-block">
      → Voir ma démo gratuite
    </a>
  </p>
  <p>C'est un site pour <strong>${name}</strong> à ${city}. Prenez 30 secondes pour regarder.</p>
  <p>Si ça vous intéresse, répondez-moi directement.</p>
  <p>${sender}</p>
  ${pixelHtml}
  ${unsubFooter()}
</div>`,
  },

  {
    step:    1,
    delay:   3,   // J+3
    subject: ({ name }) => `Re: ${name}`,
    variant: 'step1_relance_soft',
    text: ({ url, sender }) =>
`Bonjour,

Je me permets de revenir rapidement.

La démo est toujours disponible : ${url}

Si ce n'est pas le bon moment, dites-le moi — aucun souci.

${sender}`,
    html: ({ pixelHtml, trackedUrl, sender }) => `
<div style="font-family:Arial,sans-serif;font-size:14px;color:#111;max-width:520px;line-height:1.7">
  <p>Bonjour,</p>
  <p>Je me permets de revenir rapidement.</p>
  <p style="margin:16px 0">
    <a href="${trackedUrl}" style="color:#2563eb;font-weight:bold">La démo est toujours disponible ici →</a>
  </p>
  <p>Si ce n'est pas le bon moment, dites-le moi — aucun souci.</p>
  <p>${sender}</p>
  ${pixelHtml}
  ${unsubFooter()}
</div>`,
  },

  {
    step:    2,
    delay:   7,   // J+7
    subject: ({ name }) => `Dernier message — ${name}`,
    variant: 'step2_last_chance',
    text: ({ name, url, sender }) =>
`Bonjour,

C'est mon dernier message.

J'avais créé ce site pour ${name} : ${url}

Si vous le voulez, répondez. Sinon, bonne continuation.

${sender}`,
    html: ({ name, pixelHtml, trackedUrl, sender }) => `
<div style="font-family:Arial,sans-serif;font-size:14px;color:#111;max-width:520px;line-height:1.7">
  <p>Bonjour,</p>
  <p>C'est mon dernier message.</p>
  <p>J'avais créé un site pour <strong>${name}</strong> :</p>
  <p style="margin:16px 0">
    <a href="${trackedUrl}" style="background:#dc2626;color:#fff;padding:12px 26px;border-radius:6px;text-decoration:none;font-weight:bold;display:inline-block">
      Voir la démo →
    </a>
  </p>
  <p>Si vous le voulez, répondez. Sinon, bonne continuation.</p>
  <p>${sender}</p>
  ${pixelHtml}
  ${unsubFooter()}
</div>`,
  },
];

function unsubFooter() {
  const from = process.env.SMTP_FROM || process.env.SMTP_USER || '';
  return `<p style="margin-top:24px;font-size:11px;color:#999">
    <a href="mailto:${from}?subject=Désabonnement" style="color:#999">Se désabonner</a>
  </p>`;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Enregistre un site dans la séquence email.
 * Appelé après chaque génération réussie.
 */
export function enrollSite(siteId, leadId, score = 0) {
  ensureSequenceSchema();
  const db = getDb();
  const id = randomBytes(8).toString('hex');

  db.prepare(`
    INSERT OR IGNORE INTO email_sequence (id, site_id, lead_id, step, status, next_send_at, score)
    VALUES (?, ?, ?, 0, 'pending', datetime('now'), ?)
  `).run(id, siteId, leadId, score);
}

/**
 * Traite tous les emails en attente d'envoi.
 * À appeler régulièrement (toutes les 30 min via cron ou worker).
 */
export async function processSequence() {
  ensureSequenceSchema();
  const db = getDb();

  const due = db.prepare(`
    SELECT * FROM email_sequence
    WHERE status = 'pending'
      AND next_send_at <= datetime('now')
    ORDER BY score DESC, next_send_at ASC
    LIMIT 50
  `).all();

  if (!due.length) {
    logger.debug('[Sequence] No emails due');
    return { sent: 0, errors: 0 };
  }

  logger.info(`[Sequence] Processing ${due.length} pending emails`);

  const stats = { sent: 0, errors: 0 };
  const senderName = process.env.SMTP_SENDER_NAME || 'AutoDemo';

  for (const entry of due) {
    try {
      const site = Site.findById(entry.site_id);
      const lead = Lead.findById(entry.lead_id);

      if (!site || !lead?.email) {
        db.prepare("UPDATE email_sequence SET status = 'done' WHERE id = ?").run(entry.id);
        continue;
      }

      // Vérifier si la séquence doit continuer selon engagement
      if (entry.step > 0) {
        const hasClicked = db.prepare(`
          SELECT id FROM email_events
          WHERE lead_id = ? AND event_type = 'click' LIMIT 1
        `).get(lead.id);

        if (hasClicked) {
          // A cliqué → fin de séquence (converti ?)
          db.prepare("UPDATE email_sequence SET status = 'done' WHERE id = ?").run(entry.id);
          continue;
        }
      }

      const template = STEPS[entry.step];
      if (!template) {
        db.prepare("UPDATE email_sequence SET status = 'done' WHERE id = ?").run(entry.id);
        continue;
      }

      // Génération du tracking
      const { token, pixelHtml } = createTrackingPixel({
        siteId:  site.id,
        leadId:  lead.id,
        variant: template.variant,
      });

      const trackedUrl = wrapLink({ url: site.url, token, label: 'cta' });

      const ctx = {
        name:      lead.name,
        city:      lead.city,
        url:       site.url,
        sender:    senderName,
        pixelHtml,
        trackedUrl,
      };

      await smtpManager.send({
        to:      lead.email,
        subject: template.subject(ctx),
        text:    template.text(ctx),
        html:    template.html(ctx),
        headers: { 'X-Variant': template.variant },
      });

      // Calcul prochaine étape
      const nextStep      = entry.step + 1;
      const nextTemplate  = STEPS[nextStep];
      const hasMoreSteps  = !!nextTemplate;

      db.prepare(`
        UPDATE email_sequence
        SET step         = ?,
            status       = ?,
            last_sent_at = datetime('now'),
            next_send_at = ${hasMoreSteps ? `datetime('now', '+${nextTemplate.delay} days')` : 'NULL'}
        WHERE id = ?
      `).run(nextStep, hasMoreSteps ? 'pending' : 'done', entry.id);

      stats.sent++;
      logger.info(`[Sequence] Step ${entry.step} sent: ${lead.email} | variant=${template.variant}`);

      // Délai entre envois
      await new Promise(r => setTimeout(r, 2000 + Math.random() * 1000));

    } catch (err) {
      logger.error(`[Sequence] Error for entry ${entry.id}: ${err.message}`);
      stats.errors++;
    }
  }

  return stats;
}

/**
 * Désabonnement d'un lead.
 */
export function unsubscribe(leadId) {
  getDb().prepare(
    "UPDATE email_sequence SET status = 'unsubscribed' WHERE lead_id = ?"
  ).run(leadId);
}
