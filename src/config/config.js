import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import dotenv from 'dotenv';
dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname  = dirname(__filename);
const ROOT       = join(__dirname, '../..');

function required(name) {
  const val = process.env[name];
  if (!val) throw new Error(`[Config] Variable d'environnement manquante: ${name}`);
  return val;
}

function optional(name, fallback) {
  return process.env[name] ?? fallback;
}

export const config = {
  paths: {
    root:      ROOT,
    db:        optional('DB_PATH', join(ROOT, 'data', 'saas.db')),
    templates: join(ROOT, 'templates'),
    output:    optional('OUTPUT_DIR', join(ROOT, 'output')),
    template:  join(ROOT, 'templates', 'template.html'),
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
  },

  rateLimit: {
    windowMs:       parseInt(optional('RATE_WINDOW_MS', '900000')),
    maxRequests:    parseInt(optional('RATE_MAX_REQUESTS', '100')),
    generateWindowMs: parseInt(optional('RATE_GEN_WINDOW_MS', '3600000')),
    generateMax:    parseInt(optional('RATE_GEN_MAX', '20')),
  },

  security: {
    maxInputLength:  parseInt(optional('MAX_INPUT_LENGTH', '200')),
    jwtSecret:       optional('JWT_SECRET', ''),
    jwtExpiry:       optional('JWT_EXPIRY', '30d'),
    bcryptRounds:    parseInt(optional('BCRYPT_ROUNDS', '10')),
  },
};

export function validateConfig() {
  const errors = [];

  if (!config.security.jwtSecret || config.security.jwtSecret.length < 32) {
    errors.push('JWT_SECRET doit faire au moins 32 caractères');
  }

  if (config.server.env === 'production') {
    if (!config.ai.apiKey || config.ai.apiKey === 'sk-...') {
      errors.push('AI_API_KEY est requis en production');
    }
    if (config.server.baseUrl === 'http://localhost:3000') {
      errors.push('BASE_URL doit être configuré en production');
    }
  }

  if (errors.length > 0) {
    throw new Error(`[Config] Erreurs de configuration:\n${errors.map(e => `  - ${e}`).join('\n')}`);
  }
}
