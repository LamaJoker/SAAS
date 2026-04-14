import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import dotenv from 'dotenv';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = join(__dirname, '../..');

export const config = {
  paths: {
    root: ROOT,
    db: process.env.DB_PATH || join(ROOT, 'data', 'saas.db'),
    templates: join(ROOT, 'templates'),
    output: process.env.OUTPUT_DIR || join(ROOT, 'output'),
    template: join(ROOT, 'templates', 'template.html'),
  },

  ai: {
    apiKey: process.env.AI_API_KEY || '',
    model: process.env.AI_MODEL || 'gpt-4o-mini',
    baseUrl: process.env.AI_BASE_URL || 'https://api.openai.com/v1',
    mockMode: process.env.AI_MOCK_MODE === 'true',
    maxTokens: parseInt(process.env.AI_MAX_TOKENS || '1500'),
    temperature: parseFloat(process.env.AI_TEMPERATURE || '0.7'),
  },

  generation: {
    concurrency: parseInt(process.env.GEN_CONCURRENCY || '3'),
    retryAttempts: parseInt(process.env.GEN_RETRY_ATTEMPTS || '2'),
    retryDelay: parseInt(process.env.GEN_RETRY_DELAY || '1000'),
    timeoutMs: parseInt(process.env.GEN_TIMEOUT_MS || '30000'),
  },

  credits: {
    defaultOnSignup: parseInt(process.env.CREDITS_DEFAULT || '10'),
    costPerGeneration: parseInt(process.env.CREDITS_PER_GEN || '1'),
  },

  server: {
    port: parseInt(process.env.PORT || '3000'),
    baseUrl: process.env.BASE_URL || 'http://localhost:3000',
    env: process.env.NODE_ENV || 'development',
  },

  rateLimit: {
    windowMs: parseInt(process.env.RATE_WINDOW_MS || '900000'),
    maxRequests: parseInt(process.env.RATE_MAX_REQUESTS || '100'),
    generateWindowMs: parseInt(process.env.RATE_GEN_WINDOW_MS || '3600000'),
    generateMax: parseInt(process.env.RATE_GEN_MAX || '20'),
  },

  security: {
    maxInputLength: parseInt(process.env.MAX_INPUT_LENGTH || '200'),
    allowedCharsPattern: /^[\w\s\-àâäéèêëîïôùûüç',.!?&()]+$/i,
  },
};
