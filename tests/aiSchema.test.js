import { describe, it, expect } from 'vitest';
import { repairContent } from '../src/services/aiSchema.js';
import { extractJson }   from '../src/services/aiService.js';

const MOCK = {
  heroTitle: 'M-TITLE', heroSubtitle: 'M-SUB', cta: 'M-CTA',
  services: ['m-s1'], benefits: ['m-b1'],
  testimonials: [{ text: 'm-t', author: 'm-a' }],
};

describe('repairContent', () => {
  it('conserve intégralement une sortie IA valide', () => {
    const ai = {
      heroTitle: 'Vrai titre', heroSubtitle: 'Vrai sous-titre', cta: 'Appelez !',
      services: ['Dépannage 24/7', 'Devis gratuit'],
      benefits: ['10 ans d\'expérience'],
      testimonials: [{ text: 'Top service', author: 'Marie L.' }],
    };
    const { content, fallbacks } = repairContent(ai, MOCK);
    expect(fallbacks).toEqual([]);
    expect(content).toEqual(ai);
  });

  it('remplace uniquement les champs invalides (fusion, pas tout-ou-rien)', () => {
    const ai = {
      heroTitle: 'Bon titre',
      heroSubtitle: 42,                    // mauvais type
      cta: 'x'.repeat(500),                // trop long
      services: 'pas un tableau',          // mauvais type
      benefits: ['ok'],
      testimonials: [{ text: 'ok', author: 'A' }],
    };
    const { content, fallbacks } = repairContent(ai, MOCK);
    expect(content.heroTitle).toBe('Bon titre');           // conservé
    expect(content.benefits).toEqual(['ok']);              // conservé
    expect(content.heroSubtitle).toBe('M-SUB');            // mock
    expect(content.cta).toBe('M-CTA');                     // mock
    expect(content.services).toEqual(['m-s1']);            // mock
    expect(fallbacks.sort()).toEqual(['cta', 'heroSubtitle', 'services']);
  });

  it('mock complet pour une entrée totalement dégénérée', () => {
    for (const bad of [null, undefined, 'texte', [], 42]) {
      const { content, fallbacks } = repairContent(bad, MOCK);
      expect(content).toEqual(MOCK);
      expect(fallbacks.length).toBe(6);
    }
  });

  it('rejette un témoignage sans auteur', () => {
    const { content, fallbacks } = repairContent(
      { ...MOCK, testimonials: [{ text: 'sans auteur' }] }, MOCK
    );
    expect(fallbacks).toContain('testimonials');
    expect(content.testimonials).toEqual(MOCK.testimonials);
  });
});

describe('extractJson', () => {
  it('parse un JSON propre', () => {
    expect(extractJson('{"a":1}')).toEqual({ a: 1 });
  });
  it('tolère les code fences markdown', () => {
    expect(extractJson('```json\n{"a":1}\n```')).toEqual({ a: 1 });
  });
  it('tolère le bavardage avant/après l\'objet', () => {
    expect(extractJson('Voici le JSON demandé :\n{"a":1}\nVoilà !')).toEqual({ a: 1 });
  });
  it('lève si aucun objet', () => {
    expect(() => extractJson('aucun json ici')).toThrow(/Aucun objet JSON/);
  });
});
