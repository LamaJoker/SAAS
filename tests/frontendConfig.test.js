/**
 * Garde de régression : le frontend est servi par la même origine que l'API.
 * Une URL absolue codée en dur (« http://localhost:3000 ») fonctionne en local
 * et casse tout en production : le navigateur du client appelle sa propre
 * machine, et la CSP `connect-src 'self'` bloque de toute façon la requête.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

// fileURLToPath plutôt que import.meta.dirname : compatible Node 18 (engines)
const FRONTEND = join(dirname(fileURLToPath(import.meta.url)), '..', 'frontend');
const scripts  = readdirSync(FRONTEND).filter(f => f.endsWith('.js'));

describe('frontend — origine de l\'API', () => {
  it.each(scripts)('%s n\'appelle aucune origine codée en dur', (file) => {
    const src = readFileSync(join(FRONTEND, file), 'utf8');
    expect(src).not.toMatch(/https?:\/\/localhost/);
    expect(src).not.toMatch(/fetch\(\s*['"`]https?:\/\//);
  });
});
