import { fileURLToPath } from 'url';
import { dirname, join, isAbsolute } from 'path';
import dotenv from 'dotenv';
import { logger } from '../utils/logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = dirname(__filename);
const ROOT       = join(__dirname, '../..');

// Charge le .env du projet quel que soit le répertoire de lancement
dotenv.config({ path: join(ROOT, '.env') });

// Résout un chemin (potentiellement relatif) par rapport à la racine du projet,
// pour que DB_PATH=./data/saas.db fonctionne quel que soit le cwd.
function fromRoot(p) {
  return isAbsolute(p) ? p : join(ROOT, p);
}

function optional(name, fallback) {
  return process.env[name] ?? fallback;
}

export const config = {
  paths: {
    root:      ROOT,
    db:        fromRoot(optional('DB_PATH', join(ROOT, 'data', 'saas.db'))),
    templates: join(ROOT, 'templates'),
    output:    fromRoot(optional('OUTPUT_DIR', join(ROOT, 'output'))),
  },

  ai: {
    apiKey:      optional('AI_API_KEY', ''),
    model:       optional('AI_MODEL', 'gpt-4o-mini'),
    baseUrl:     optional('AI_BASE_URL', 'https://api.openai.com/v1'),
    mockMode:    optional('AI_MOCK_MODE', 'false') === 'true',
    maxTokens:   parseInt(optional('AI_MAX_TOKENS', '1500')),
    temperature: parseFloat(optional('AI_TEMPERATURE', '0.7')),
  },

  generation: {
    concurrency:   parseInt(optional('GEN_CONCURRENCY', '3')),
    retryAttempts: parseInt(optional('GEN_RETRY_ATTEMPTS', '2')),
    retryDelay:    parseInt(optional('GEN_RETRY_DELAY', '1000')),
    timeoutMs:     parseInt(optional('GEN_TIMEOUT_MS', '30000')),
  },

  credits: {
    defaultOnSignup:    parseInt(optional('CREDITS_DEFAULT', '10')),
    costPerGeneration:  parseInt(optional('CREDITS_PER_GEN', '1')),
  },

  server: {
    port:    parseInt(optional('PORT', '3000')),
    baseUrl: optional('BASE_URL', 'http://localhost:3000'),
    env:     optional('NODE_ENV', 'development'),

    // Domaine dédié aux démos. Deux raisons de le séparer du domaine applicatif :
    //   1. crédibilité — un prospect qui reçoit « votre-saas.fr/demos/plombier-x »
    //      voit un outil de prospection, pas son site ;
    //   2. délivrabilité — le domaine qui ENVOIE les emails ne doit pas être le
    //      même que celui qui héberge les liens cliqués, sinon un incident de
    //      réputation sur l'un contamine l'autre.
    // Vide = tout reste sur baseUrl (comportement actuel, rien ne change).
    demoHost:    optional('DEMO_HOST', ''),                  // ex. demos.mon-domaine.fr
    demoBaseUrl: optional('DEMO_BASE_URL', ''),              // ex. https://demos.mon-domaine.fr
  },

  rateLimit: {
    windowMs:       parseInt(optional('RATE_WINDOW_MS', '900000')),
    maxRequests:    parseInt(optional('RATE_MAX_REQUESTS', '100')),
    generateWindowMs: parseInt(optional('RATE_GEN_WINDOW_MS', '3600000')),
    generateMax:    parseInt(optional('RATE_GEN_MAX', '20')),
    authWindowMs:   parseInt(optional('RATE_AUTH_WINDOW_MS', '900000')),
    authMax:        parseInt(optional('RATE_AUTH_MAX', '10')),
  },

  cors: {
    // Liste d'origines autorisées ; vide = même origine uniquement (pas de CORS)
    origins: optional('CORS_ORIGIN', '').split(',').map(s => s.trim()).filter(Boolean),
  },

  security: {
    maxInputLength:  parseInt(optional('MAX_INPUT_LENGTH', '200')),
    jwtSecret:       optional('JWT_SECRET', ''),
    jwtExpiry:       optional('JWT_EXPIRY', '30d'),
    bcryptRounds:    parseInt(optional('BCRYPT_ROUNDS', '10')),
  },

  // ── Facturation (identité vendeur + TVA pour les factures légales) ─────────
  billing: {
    seller: {
      name:    optional('BILLING_SELLER_NAME', 'AutoDemo'),
      address: optional('BILLING_SELLER_ADDRESS', ''),
      siret:   optional('BILLING_SELLER_SIRET', ''),
      vat:     optional('BILLING_SELLER_VAT', ''),       // ex: FR12345678901
      country: optional('BILLING_SELLER_COUNTRY', 'FR'),
      email:   optional('BILLING_SELLER_EMAIL', ''),
    },
    vatRate: parseFloat(optional('BILLING_VAT_RATE', '20')), // taux domestique %
  },

  // ── Informations légales (mentions, confidentialité, CGV, emails) ──────────
  // Réutilise l'identité vendeur + champs spécifiques. Les pages affichent un
  // bandeau "modèle à faire valider" tant que les champs clés sont vides.
  legal: {
    company:   optional('BILLING_SELLER_NAME', 'AutoDemo'),
    legalForm: optional('LEGAL_FORM', ''),               // SAS, SARL, EI…
    capital:   optional('LEGAL_CAPITAL', ''),
    address:   optional('BILLING_SELLER_ADDRESS', ''),
    siret:     optional('BILLING_SELLER_SIRET', ''),
    rcs:       optional('LEGAL_RCS', ''),
    vat:       optional('BILLING_SELLER_VAT', ''),
    director:  optional('LEGAL_DIRECTOR', ''),            // directeur de publication
    email:     optional('BILLING_SELLER_EMAIL', ''),
    dpoEmail:  optional('LEGAL_DPO_EMAIL', ''),           // contact RGPD
    hosting:   optional('LEGAL_HOSTING', ''),             // hébergeur (nom + adresse)
  },

  // ── Fonctionnalités activables ────────────────────────────────────────────
  // Chacune est dormante tant que sa config n'est pas posée : aucune ne casse
  // le démarrage. `GET /features` expose l'état (actif/dormant) de chacune.
  features: {
    // ① Enrichissement email des leads scrapés (sinon canal email impossible)
    enrichment: {
      enabled:  optional('ENRICHMENT_ENABLED', 'false') === 'true',
      provider: optional('ENRICHMENT_PROVIDER', 'website'), // website | api
      apiUrl:   optional('ENRICHMENT_API_URL', ''),
      apiKey:   optional('ENRICHMENT_API_KEY', ''),
    },
    // ① bis Canal WhatsApp pour les leads sans email (téléphone seul)
    whatsapp: {
      enabled: optional('WHATSAPP_ENABLED', 'false') === 'true',
      // credentials Twilio lus dans whatsappService (TWILIO_*)
    },
    // ② Détection des réponses entrantes → stop séquence + pipeline
    inbound: {
      enabled: optional('INBOUND_ENABLED', 'false') === 'true',
      secret:  optional('INBOUND_SECRET', ''),          // protège POST /inbound/:secret
      imap: {                                            // poller optionnel (lazy imapflow)
        host: optional('IMAP_HOST', ''),
        port: parseInt(optional('IMAP_PORT', '993')),
        user: optional('IMAP_USER', ''),
        pass: optional('IMAP_PASS', ''),
        pollSeconds: parseInt(optional('IMAP_POLL_SECONDS', '120')),
      },
    },
    // ③ Délivrabilité : signature DKIM + warmup progressif
    dkim: {
      domain:     optional('DKIM_DOMAIN', ''),
      selector:   optional('DKIM_SELECTOR', 'default'),
      privateKey: optional('DKIM_PRIVATE_KEY', ''),      // PEM en clair ou \n échappés
    },
    warmup: {
      enabled:        optional('WARMUP_ENABLED', 'false') === 'true',
      startPerDay:    parseInt(optional('WARMUP_START', '20')),
      incrementPerDay:parseInt(optional('WARMUP_STEP', '20')),
      maxPerDay:      parseInt(optional('WARMUP_MAX', '200')),
      startedAt:      optional('WARMUP_STARTED_AT', ''),  // ISO ; défaut = 1er envoi
    },
    // ④ Images des sites démo
    demoImages: {
      provider: optional('DEMO_IMAGES_PROVIDER', 'none'), // none | loremflickr
    },
    // ⑤ Filtrage Apple Mail Privacy Protection sur les ouvertures
    apmpFilter: {
      enabled:        optional('APMP_FILTER_ENABLED', 'true') === 'true',
      prefetchSeconds:parseInt(optional('APMP_PREFETCH_SECONDS', '10')),
    },
  },
};

export function validateConfig() {
  const errors = [];

  if (!config.security.jwtSecret || config.security.jwtSecret.length < 32) {
    errors.push('JWT_SECRET doit faire au moins 32 caractères');
  }

  if (config.server.env === 'production') {
    // AI_MOCK_MODE=true est un mode de déploiement légitime : c'est celui du
    // blueprint Render, qui permet de faire tourner l'application complète sans
    // clé API. Exiger AI_API_KEY ici faisait échouer le démarrage sur une
    // configuration que le dépôt documente lui-même — deux parties du projet se
    // contredisaient, et l'erreur n'apparaissait qu'au déploiement.
    if (!config.ai.mockMode && (!config.ai.apiKey || config.ai.apiKey === 'sk-...')) {
      errors.push('AI_API_KEY est requis en production (ou AI_MOCK_MODE=true pour une démo sans clé)');
    }
    if (config.server.baseUrl === 'http://localhost:3000') {
      errors.push('BASE_URL doit être configuré en production');
    }
    if (!config.cors.origins.length) {
      errors.push('CORS_ORIGIN est requis en production (liste d\'origines séparées par des virgules)');
    }
  }

  if (errors.length > 0) {
    throw new Error(`[Config] Erreurs de configuration:\n${errors.map(e => `  - ${e}`).join('\n')}`);
  }

  if (config.server.env === 'production' && config.ai.mockMode) {
    // Démarrage autorisé, mais jamais silencieux : sans cet avertissement, on
    // peut servir du contenu de repli en production sans s'en rendre compte.
    logger.warn('[Config] AI_MOCK_MODE=true en production — le contenu des sites '
              + 'provient du générateur de repli, pas du modèle. Posez AI_API_KEY '
              + 'et retirez AI_MOCK_MODE pour une génération réelle.');
  }
}
