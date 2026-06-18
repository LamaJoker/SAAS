import { describe, it, expect } from 'vitest';
import { renderMentions, renderPrivacy, renderCGV, renderIndex } from '../src/services/legalService.js';
import { buildUnsubFooter } from '../src/email/render.js';

describe('legalService', () => {
  it('mentions légales : éditeur + hébergement', () => {
    const h = renderMentions();
    expect(h).toContain('Mentions légales');
    expect(h).toContain('AutoDemo');           // BILLING_SELLER_NAME défaut
    expect(h).toContain('Hébergement');
  });

  it('confidentialité : droits RGPD dont portabilité + CNIL', () => {
    const h = renderPrivacy();
    expect(h).toMatch(/portabilité/i);
    expect(h).toContain('CNIL');
    expect(h).toMatch(/effacement/i);
  });

  it('CGV : abonnement + droit applicable', () => {
    const h = renderCGV();
    expect(h).toContain('Conditions générales de vente');
    expect(h).toMatch(/abonnement/i);
    expect(h).toMatch(/[Dd]roit français/);
  });

  it('affiche un bandeau "à compléter" quand les champs clés manquent', () => {
    // En test, adresse/siret/hébergeur sont vides → bandeau présent
    expect(renderMentions()).toMatch(/à faire valider|À COMPLÉTER/i);
  });

  it('index liste les trois pages', () => {
    const h = renderIndex();
    expect(h).toContain('/legal/mentions');
    expect(h).toContain('/legal/confidentialite');
    expect(h).toContain('/legal/cgv');
  });
});

describe('email · footer postal', () => {
  it('contient le lien de désinscription et l\'identité expéditeur', () => {
    const f = buildUnsubFooter('prospect@entreprise.fr');
    expect(f).toContain('/unsubscribe/');
    expect(f).toContain('AutoDemo');           // identité expéditeur (CAN-SPAM)
  });
});
