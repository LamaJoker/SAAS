/**
 * configValidation.test.js — Garde-fou sur la validation de configuration.
 *
 * Contexte : le blueprint Render documente un déploiement sans clé API, via
 * AI_MOCK_MODE=true. La validation exigeait pourtant AI_API_KEY en production et
 * faisait échouer le démarrage — deux parties du dépôt se contredisaient, et
 * l'erreur n'apparaissait qu'au déploiement, pas en test ni en CI.
 *
 * Ces tests relancent la validation dans un processus isolé, seule façon de
 * tester un module qui fige la configuration à son chargement.
 */
import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';

const SECRET = 'x'.repeat(40);

/** Charge config.js dans un process neuf et renvoie { ok, stderr }. */
function validateWith(env) {
  try {
    const stdout = execFileSync(
      process.execPath,
      ['-e', "import('./src/config/config.js').then(m => { m.validateConfig(); console.log('OK'); })"],
      { env: { ...process.env, LOG_TO_FILE: 'false', ...env }, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }
    );
    return { ok: stdout.includes('OK'), stderr: '' };
  } catch (err) {
    return { ok: false, stderr: String(err.stderr ?? err.message) };
  }
}

const PROD = {
  NODE_ENV: 'production',
  JWT_SECRET: SECRET,
  BASE_URL: 'https://exemple.onrender.com',
  CORS_ORIGIN: 'https://exemple.onrender.com',
  AI_API_KEY: '',
  AI_MOCK_MODE: 'false',
};

describe('validateConfig en production', () => {
  it('accepte AI_MOCK_MODE=true sans clé API — c\'est la configuration du blueprint Render', () => {
    const { ok } = validateWith({ ...PROD, AI_MOCK_MODE: 'true' });
    expect(ok).toBe(true);
  });

  it('refuse toujours de démarrer sans clé ET sans mode mock', () => {
    const { ok, stderr } = validateWith(PROD);
    expect(ok).toBe(false);
    expect(stderr).toMatch(/AI_API_KEY/);
  });

  it('refuse un JWT_SECRET trop court', () => {
    const { ok, stderr } = validateWith({ ...PROD, AI_MOCK_MODE: 'true', JWT_SECRET: 'court' });
    expect(ok).toBe(false);
    expect(stderr).toMatch(/JWT_SECRET/);
  });

  it('refuse BASE_URL laissé sur localhost', () => {
    const { ok, stderr } = validateWith({ ...PROD, AI_MOCK_MODE: 'true', BASE_URL: 'http://localhost:3000' });
    expect(ok).toBe(false);
    expect(stderr).toMatch(/BASE_URL/);
  });

  it('refuse CORS_ORIGIN vide', () => {
    const { ok, stderr } = validateWith({ ...PROD, AI_MOCK_MODE: 'true', CORS_ORIGIN: '' });
    expect(ok).toBe(false);
    expect(stderr).toMatch(/CORS_ORIGIN/);
  });
});
