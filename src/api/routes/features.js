/**
 * routes/features.js — État d'activation des fonctionnalités optionnelles.
 * Alimente le panneau « Intégrations » du dashboard : chaque étape du workflow
 * y est visible comme active ou dormante, avec la variable à poser pour l'activer.
 */
import express from 'express';
import { config } from '../../config/config.js';

const router = express.Router();

router.get('/', (req, res) => {
  const f = config.features;
  const twilioCreds = !!(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN);

  res.json({
    success: true,
    data: {
      enrichment: {
        active: f.enrichment.enabled,
        detail: `provider=${f.enrichment.provider}`,
        enable: 'ENRICHMENT_ENABLED=true (+ ENRICHMENT_PROVIDER, API_URL/KEY si api)',
      },
      whatsapp: {
        active: f.whatsapp.enabled && twilioCreds,
        detail: f.whatsapp.enabled
          ? (twilioCreds ? 'Twilio configuré' : 'activé mais credentials Twilio manquants')
          : 'désactivé',
        enable: 'WHATSAPP_ENABLED=true + TWILIO_ACCOUNT_SID/AUTH_TOKEN/WHATSAPP_NUMBER',
      },
      inbound: {
        active: f.inbound.enabled && !!f.inbound.secret,
        detail: f.inbound.imap.host ? 'webhook + poller IMAP' : 'webhook',
        enable: 'INBOUND_ENABLED=true + INBOUND_SECRET (poller : IMAP_HOST/USER/PASS + npm i imapflow)',
      },
      dkim: {
        active: !!(f.dkim.domain && f.dkim.privateKey),
        detail: f.dkim.domain ? `domaine ${f.dkim.domain}` : 'non configuré',
        enable: 'DKIM_DOMAIN + DKIM_SELECTOR + DKIM_PRIVATE_KEY',
      },
      warmup: {
        active: f.warmup.enabled,
        detail: f.warmup.enabled ? `${f.warmup.startPerDay}→${f.warmup.maxPerDay}/j` : 'plafond illimité',
        enable: 'WARMUP_ENABLED=true (+ WARMUP_START/STEP/MAX)',
      },
      demoImages: {
        active: f.demoImages.provider !== 'none',
        detail: `provider=${f.demoImages.provider}`,
        enable: 'DEMO_IMAGES_PROVIDER=loremflickr',
      },
      apmpFilter: {
        active: f.apmpFilter.enabled,
        detail: `prefetch < ${f.apmpFilter.prefetchSeconds}s = machine`,
        enable: 'APMP_FILTER_ENABLED=true (actif par défaut)',
      },
    },
  });
});

export default router;
