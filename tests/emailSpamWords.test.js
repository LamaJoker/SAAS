/**
 * Mots déclencheurs de filtres anti-spam dans les emails de prospection.
 *
 * Liste reprise de l'ancien scripts/sendEmails.js, qui la vérifiait à chaque
 * envoi. Les templates du serveur étant fixes, la vérifier ici, une fois pour
 * toutes et pour chaque variante, est plus sûr qu'un contrôle à l'exécution :
 * un mot interdit ajouté à un template casse la CI avant le premier envoi.
 */
import { describe, it, expect } from 'vitest';
import { renderEmail } from '../src/email/render.js';
import { VARIANT_IDS, FOLLOWUP_IDS } from '../src/email/index.js';

const SPAM_WORDS = [
  'gratuit', 'urgent', '100%', 'garantie', 'cliquez ici', 'offre limitée',
  'gagnez', 'casino', 'crédit immédiat', 'sans risque', 'félicitations',
  'cher ami', 'argent rapide', 'opportunité unique', 'winner',
];

const ctx = {
  name: 'Garage Martin', city: 'Lyon', sender: 'AutoDemo',
  trackedUrl: 'https://demo.test/garage-martin', pixelUrl: 'https://demo.test/p.gif',
  toEmail: 'contact@garage-martin.fr',
};

describe('emails de prospection — mots déclencheurs de spam', () => {
  it.each([...VARIANT_IDS, ...FOLLOWUP_IDS])('« %s » : ni l\'objet ni le texte n\'en contiennent', (id) => {
    const { subject, text } = renderEmail(id, ctx);
    const found = SPAM_WORDS.filter(w => `${subject} ${text}`.toLowerCase().includes(w));
    expect(found).toEqual([]);
  });
});
