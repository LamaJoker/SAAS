/**
 * Un seul circuit d'envoi : la séquence du serveur (et /resend), qui applique
 * liste de désinscription, plafond, espacement, warmup et reprise humaine.
 *
 * Trois scripts envoyaient auparavant leurs propres emails en parallèle, sans
 * ces contrôles. Garde : aucun script ne doit réembarquer un client SMTP.
 */
import { beforeAll, describe, it, expect } from 'vitest';
import request from 'supertest';
import { readFileSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createApp } from '../src/api/index.js';
import { runMigrations } from '../src/db/database.js';

const SCRIPTS = join(dirname(fileURLToPath(import.meta.url)), '..', 'scripts');

function jsFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap(e =>
    e.isDirectory() ? jsFiles(join(dir, e.name)) : e.name.endsWith('.js') ? [join(dir, e.name)] : []);
}

describe('circuit d\'envoi unique', () => {
  it.each(jsFiles(SCRIPTS).map(f => [f.slice(SCRIPTS.length + 1), f]))(
    'scripts/%s n\'envoie pas d\'email lui-même', (_name, file) => {
      const src = readFileSync(file, 'utf8');
      expect(src).not.toMatch(/from ['"]nodemailer['"]|createTransport\(|sendMail\(/);
    });
});

describe('GET /sites', () => {
  let app;
  beforeAll(() => { runMigrations(); app = createApp(); });

  it('expose l\'email du prospect (bouton « Relancer » de l\'onglet Sites)', async () => {
    const agent = request.agent(app);
    await agent.post('/users/register').send({ email: `sites-${Date.now()}@test.fr`, password: 'Password1234' });
    const lead = await agent.post('/leads').send({ name: 'Cordonnerie Blanc', activity: 'cordonnier', city: 'Gray', email: 'contact@cordonnerie-blanc.fr' });
    await agent.post('/generate').send({ leadId: lead.body.data.id });

    const sites = (await agent.get('/sites')).body.data;
    expect(sites[0].lead_email).toBe('contact@cordonnerie-blanc.fr');
  });
});
