import { describe, it, expect } from 'vitest';
import { scoreLead } from '../src/services/sequenceService.js';
import { computeEngagementScore } from '../src/services/scoringService.js';

describe('scoreLead', () => {
  const freshLead = (extra = {}) => ({
    created_at: new Date().toISOString(),
    name: 'Test', activity: 'plombier', city: 'Lyon',
    phone: '0612345678', email: 'a@b.fr',
    ...extra,
  });

  it('score élevé pour un lead frais haute valeur avec téléphone', () => {
    // 30 (frais) + 20 (tel) + 5 (email) + 15 (haute valeur) + 10 (pas de site)
    expect(scoreLead(freshLead())).toBe(80);
  });

  it('score réduit pour un lead ancien sans contact', () => {
    const old = freshLead({
      created_at: new Date(Date.now() - 30 * 86_400_000).toISOString(),
      phone: null, email: null, activity: 'fleuriste',
    });
    expect(scoreLead(old)).toBe(10); // uniquement "pas de site"
  });

  it('pénalise un site déjà vu', () => {
    expect(scoreLead(freshLead(), { views: 3 })).toBe(75);
  });

  it('reste borné entre 0 et 100', () => {
    const max = freshLead({ rating: 5 });
    expect(scoreLead(max)).toBeLessThanOrEqual(100);
    expect(scoreLead(max)).toBeGreaterThanOrEqual(0);
  });
});

describe('computeEngagementScore', () => {
  it('100 immédiat si formulaire de contact soumis', () => {
    const score = computeEngagementScore({ views: 0 }, [{ type: 'contact_form' }]);
    expect(score).toBe(100);
  });

  it('0 pour un site jamais vu', () => {
    expect(computeEngagementScore({ views: 0 }, [])).toBe(0);
  });

  it('croît avec les vues et la fraîcheur', () => {
    const cold = computeEngagementScore({ views: 1, last_viewed: null }, []);
    const hot  = computeEngagementScore({ views: 8, last_viewed: new Date().toISOString() }, []);
    expect(hot).toBeGreaterThan(cold);
  });
});
