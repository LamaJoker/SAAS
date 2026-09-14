/**
 * scorers.test.js — Tests des scoreurs d'évaluation.
 *
 * Un harnais d'évaluation non testé est pire qu'aucun harnais : il donne un
 * chiffre auquel on se fie pour décider de basculer un prompt en production.
 * Ces tests vérifient les deux sens — qu'un bon contenu passe, et qu'un mauvais
 * est bien attrapé sur le bon critère.
 */
import { describe, it, expect } from 'vitest';
import {
  schemaValid, lengthLimits, grounding, noFabrication,
  testimonialDiversity, activityRelevance, noLeaks, scoreContent,
} from '../evals/scorers.js';

const LEAD = { name: 'Plomberie Durand', activity: 'plombier', city: 'Besançon' };

/** Contenu conforme, sert de base à toutes les variations. */
const bon = {
  heroTitle: 'Plomberie Durand, votre plombier à Besançon',
  heroSubtitle: 'Un interlocuteur proche de chez vous, à l\'écoute de votre besoin.',
  services: [
    'Dépannage de fuite et remise en état de la canalisation',
    'Installation et remplacement de chauffe-eau',
    'Devis clair avant toute intervention sanitaire',
  ],
  benefits: [
    'Un seul interlocuteur du début à la fin',
    'Des explications sans jargon',
    'Un chantier laissé propre',
    'Une vraie disponibilité pour vos questions',
  ],
  testimonials: [
    { text: 'On m\'a expliqué le problème avant de commencer, ça change tout.', author: 'Marie L.' },
    { text: 'Ponctuel et soigneux, la facture correspondait au devis annoncé.', author: 'Thomas B.' },
    { text: 'J\'ai pu poser toutes mes questions sans me sentir pressée du tout.', author: 'Isabelle M.' },
  ],
  cta: 'Demandez votre devis gratuit',
};

const LEXIQUE = ['fuite', 'chauffe-eau', 'sanitaire', 'canalisation', 'dépannage'];

describe('contenu conforme', () => {
  it('obtient un score quasi parfait', () => {
    const { overall, failures } = scoreContent(bon, LEAD, LEXIQUE);
    expect(overall).toBeGreaterThan(0.95);
    expect(failures).toEqual([]);
  });
});

describe('lengthLimits', () => {
  it('signale chaque champ trop long avec sa taille', () => {
    const r = lengthLimits({ ...bon, heroTitle: 'x'.repeat(75) });
    expect(r.score).toBeLessThan(1);
    expect(r.details[0]).toMatch(/heroTitle: 75 car/);
  });

  it('accepte un champ pile à la limite', () => {
    expect(lengthLimits({ ...bon, cta: 'y'.repeat(50) }).score).toBe(1);
  });
});

describe('grounding', () => {
  it('détecte un nom reformulé', () => {
    const r = grounding({ ...bon, heroTitle: 'Durand Plomberie à Besançon' }, LEAD);
    expect(r.details.join()).toMatch(/à l'identique/);
  });

  it('détecte une ville absente du titre et du sous-titre', () => {
    const r = grounding({ heroTitle: 'Plomberie Durand', heroSubtitle: 'Un pro à l\'écoute.' }, LEAD);
    expect(r.details.join()).toMatch(/Besançon/);
  });
});

describe('noFabrication — le scoreur qui compte', () => {
  it.each([
    ['ancienneté',      { ...bon, benefits: ['15 ans d\'expérience à votre service', ...bon.benefits.slice(1)] }],
    ['certification',   { ...bon, benefits: ['Équipe certifiée RGE', ...bon.benefits.slice(1)] }],
    ['date',            { ...bon, heroSubtitle: 'À votre service depuis 1998 dans toute la région.' }],
    ['pourcentage',     { ...bon, cta: '98 % de clients satisfaits' }],
    ['prix',            { ...bon, services: ['Intervention à partir de 49 €', ...bon.services.slice(1)] }],
    ['note',            { ...bon, benefits: ['Noté 4,8/5 par nos clients', ...bon.benefits.slice(1)] }],
    ['volume',          { ...bon, benefits: ['Plus de 500 chantiers réalisés', ...bon.benefits.slice(1)] }],
    ['assurance',       { ...bon, benefits: ['Assurance décennale incluse', ...bon.benefits.slice(1)] }],
  ])('attrape une %s inventée', (_label, contenu) => {
    expect(noFabrication(contenu, LEAD).score).toBeLessThan(1);
  });

  it('ne pénalise PAS un chiffre présent dans le nom de l\'entreprise', () => {
    // « Fournil 1902 » : reprendre le nom à l'identique est exigé par le prompt.
    // Le scoreur doit distinguer une donnée fournie d'un fait inventé.
    const lead = { name: 'Fournil 1902', activity: 'boulanger', city: 'Tours' };
    const contenu = { ...bon, heroTitle: 'Fournil 1902, votre boulanger à Tours' };
    expect(noFabrication(contenu, lead).score).toBe(1);
  });

  it('laisse passer une qualité non vérifiable', () => {
    // « soigné », « à l'écoute » : invérifiables donc non trompeurs.
    const contenu = { ...bon, benefits: ['Un travail soigné et une vraie écoute', ...bon.benefits.slice(1)] };
    expect(noFabrication(contenu, LEAD).score).toBe(1);
  });
});

describe('testimonialDiversity', () => {
  it('détecte trois témoignages recyclés', () => {
    const texte = 'Service impeccable, équipe professionnelle et vraiment très réactive.';
    const r = testimonialDiversity({
      ...bon,
      testimonials: [
        { text: texte, author: 'A.' },
        { text: texte.replace('impeccable', 'parfait'), author: 'B.' },
        { text: texte, author: 'C.' },
      ],
    });
    expect(r.score).toBeLessThan(0.5);
  });

  it('accepte trois angles différents', () => {
    expect(testimonialDiversity(bon).score).toBe(1);
  });

  it('échoue franchement s\'il en manque un', () => {
    const r = testimonialDiversity({ ...bon, testimonials: bon.testimonials.slice(0, 2) });
    expect(r.score).toBe(0);
  });
});

describe('noLeaks', () => {
  it.each([
    ['variable non remplacée', { ...bon, cta: 'Contactez {{name}} dès maintenant' }],
    ['placeholder',            { ...bon, heroTitle: 'Bienvenue chez votre entreprise' }],
    ['anglais',                { ...bon, cta: 'Contact our team today' }],
    ['crochets',               { ...bon, heroSubtitle: 'Expert en [activité] sur [ville] et alentours.' }],
  ])('attrape : %s', (_l, contenu) => {
    expect(noLeaks(contenu).score).toBe(0);
  });

  it('est binaire : aucun résidu toléré', () => {
    expect(noLeaks(bon).score).toBe(1);
  });
});

describe('activityRelevance', () => {
  it('récompense un contenu ancré dans le métier', () => {
    expect(activityRelevance(bon, LEAD, LEXIQUE).score).toBe(1);
  });

  it('sanctionne un contenu interchangeable', () => {
    const generique = {
      ...bon,
      services: ['Un accompagnement sur mesure', 'Une intervention rapide', 'Un devis gratuit'],
      benefits: ['Sérieux', 'Proximité', 'Écoute', 'Réactivité'],
    };
    expect(activityRelevance(generique, LEAD, LEXIQUE).score).toBeLessThan(0.5);
  });

  it('reste neutre sans lexique fourni', () => {
    expect(activityRelevance(bon, LEAD, []).score).toBe(1);
  });
});

describe('schemaValid et robustesse générale', () => {
  it('compte les champs inexploitables plutôt que de rejeter en bloc', () => {
    // Le schéma neutralise champ par champ : un objet quasi vide garde son
    // unique champ valide et perd les cinq autres.
    const r = schemaValid({ heroTitle: 'Plomberie Durand' });
    expect(r.score).toBeCloseTo(1 / 6, 2);
    expect(r.details).toHaveLength(5);
    expect(r.details.join()).toMatch(/testimonials/);
  });

  it('donne 1 à un contenu complet et 0 à un objet vide', () => {
    expect(schemaValid(bon).score).toBe(1);
    expect(schemaValid({}).score).toBe(0);
  });

  it('ne jette jamais sur une entrée dégénérée', () => {
    for (const entree of [null, undefined, {}, { testimonials: 'pas un tableau' }, []]) {
      expect(() => scoreContent(entree, LEAD, LEXIQUE)).not.toThrow();
      expect(scoreContent(entree, LEAD, LEXIQUE).overall).toBeLessThan(0.7);
    }
  });
});
