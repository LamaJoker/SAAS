/**
 * Golden master : verrouille le contrat de rendu de toutes les variantes.
 * Toute variante doit produire subject/text/html complets avec lien tracké,
 * pixel et footer de désabonnement — sinon le refactoring a cassé quelque chose.
 */
import { describe, it, expect } from 'vitest';
import { EMAIL_VARIANTS, FOLLOWUP_TEMPLATES } from '../src/email/index.js';
import { renderEmail } from '../src/email/render.js';

const CTX = {
  name: 'Garage Martin', city: 'Lyon', sender: 'Alex',
  url: 'https://x.fr/demos/garage-martin',
  trackedUrl: 'https://x.fr/track/click/TOK_click_cta',
  pixelUrl: 'https://x.fr/track/open/TOK',
  unsubFooter: '<p data-unsub>unsub</p>',
};

describe('contrat de rendu des variantes', () => {
  const all = { ...EMAIL_VARIANTS, ...FOLLOWUP_TEMPLATES };

  for (const [id, v] of Object.entries(all)) {
    it(`${id} produit subject/text/html complets`, () => {
      const html = v.html(CTX);
      expect(v.subject(CTX)).toBeTruthy();
      expect(v.text(CTX)).toContain(CTX.trackedUrl);  // lien tracké en texte brut
      expect(html).toContain(CTX.trackedUrl);          // lien tracké en HTML
      expect(html).toContain(CTX.pixelUrl);            // pixel d'ouverture
      expect(html).toContain(CTX.unsubFooter);         // désabonnement (CAN-SPAM/RGPD)
      expect(html).not.toMatch(/undefined|\[object/);  // ctx incomplet = visible ici
    });
  }
});

describe('façade renderEmail', () => {
  it('rend une variante avec footer unsubscribe auto-généré', () => {
    const out = renderEmail('curiosite', {
      name: 'Test', city: 'Paris', sender: 'Alex',
      trackedUrl: 'https://x.fr/t', pixelUrl: 'https://x.fr/p',
      toEmail: 'pro@entreprise.fr',
    });
    expect(out.subject).toContain('Test');
    expect(out.html).toContain('/unsubscribe/');      // footer construit depuis toEmail
    expect(out.html).toContain('https://x.fr/p');
    expect(out.variantId).toBe('curiosite');
  });

  it('rejette une variante inconnue', () => {
    expect(() => renderEmail('inexistante', {})).toThrow(/inconnue/);
  });

  it('fournit pixelHtml aux variantes qui en ont besoin', () => {
    const out = renderEmail('relance_directe', {
      name: 'Test', city: 'Paris', sender: 'Alex',
      trackedUrl: 'https://x.fr/t', pixelUrl: 'https://x.fr/p',
      toEmail: 'pro@entreprise.fr',
    });
    expect(out.html).toContain('https://x.fr/p');
  });
});
