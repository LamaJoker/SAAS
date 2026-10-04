/**
 * Tests de bout en bout dans un vrai navigateur (Chromium).
 *
 * Le serveur est lancé tel qu'en production (NODE_ENV=production, cookie
 * Secure, CSP, BASE_URL…), avec l'IA simulée et une base jetable. C'est ce qui
 * manquait pour attraper le bug « localhost:3000 » : les tests d'API passaient,
 * mais aucune page n'était chargée dans un navigateur.
 *
 * Lancer : npm run test:e2e   (navigateur : npx playwright install chromium)
 */
import { defineConfig, devices } from '@playwright/test';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { randomBytes } from 'crypto';

const PORT     = 3999;
const BASE_URL = `http://localhost:${PORT}`;
const DATA_DIR = mkdtempSync(join(tmpdir(), 'autodemo-e2e-'));

export default defineConfig({
  testDir:   './e2e',
  testMatch: '*.e2e.js',          // jamais ramassé par Vitest (*.test.js)
  timeout:   60_000,
  retries:   process.env.CI ? 1 : 0,
  reporter:  process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',

  use: {
    baseURL: BASE_URL,
    trace:   'retain-on-failure',
    screenshot: 'only-on-failure',
  },

  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],

  webServer: {
    command: 'node src/main.js',
    url:     `${BASE_URL}/health`,
    reuseExistingServer: false,
    timeout: 30_000,
    env: {
      NODE_ENV:      'production',
      PORT:          String(PORT),
      BASE_URL,
      CORS_ORIGIN:   BASE_URL,
      JWT_SECRET:    randomBytes(32).toString('hex'),
      AI_MOCK_MODE:  'true',
      SHOWCASE_MODE: 'true',
      DB_PATH:       join(DATA_DIR, 'saas.db'),
      OUTPUT_DIR:    join(DATA_DIR, 'output'),
      LOG_TO_FILE:   'false',
      LOG_LEVEL:     'warn',
    },
  },
});
