/**
 * Dates SQLite (UTC sans fuseau) relues correctement quel que soit le fuseau
 * du serveur. Exécuté dans des processus Node séparés : modifier TZ dans le
 * processus de test affecterait les autres fichiers lancés en parallèle.
 */
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'child_process';
import { join, dirname } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const mod  = (p) => pathToFileURL(join(ROOT, p)).href;

function runInTz(tz, code) {
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', code], {
    env: { ...process.env, TZ: tz, JWT_SECRET: 'x'.repeat(32), LOG_TO_FILE: 'false' },
    encoding: 'utf8',
  });
  if (r.status !== 0) throw new Error(r.stderr);
  return JSON.parse(r.stdout.trim().split('\n').at(-1));
}

describe.each(['Europe/Paris', 'America/New_York', 'UTC'])('serveur en %s', (tz) => {
  it('parseDbDate lit le format SQLite comme de l\'UTC', () => {
    const out = runInTz(tz, `
      import { parseDbDate } from '${mod('src/utils/utils.js')}';
      console.log(JSON.stringify({
        sqlite: parseDbDate('2026-10-03 18:00:00').toISOString(),
        iso:    parseDbDate('2026-10-03T18:00:00.000Z').toISOString(),
      }));`);
    expect(out).toEqual({ sqlite: '2026-10-03T18:00:00.000Z', iso: '2026-10-03T18:00:00.000Z' });
  });

  it('une ouverture 3 s après l\'envoi est reconnue comme automatique (Apple Mail)', () => {
    const out = runInTz(tz, `
      import { isMachineOpen } from '${mod('src/services/trackingService.js')}';
      const sent = new Date(Date.now() - 3000).toISOString().replace('T', ' ').slice(0, 19); // format SQLite
      console.log(JSON.stringify(isMachineOpen({ sentAt: sent, prefetchSeconds: 10 })));`);
    expect(out).toBe(true);
  });
});
