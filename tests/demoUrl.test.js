/**
 * demoUrl.test.js — Construction de l'URL publique d'une démo.
 *
 * L'URL est figée en base à la création et part telle quelle dans les emails :
 * une erreur ici est irrattrapable sur les envois déjà effectués.
 */
import { describe, it, expect } from 'vitest';
import { buildDemoUrl, usesDemoHost } from '../src/utils/demoUrl.js';

const srv = (o) => ({ baseUrl: 'https://mon-saas.fr', demoHost: '', demoBaseUrl: '', ...o });

describe('buildDemoUrl', () => {
  it('sans domaine dédié : chemin /demos sur le domaine applicatif', () => {
    expect(buildDemoUrl('plombier-lyon', srv())).toBe('https://mon-saas.fr/demos/plombier-lyon');
  });

  it('avec domaine dédié : slug à la racine', () => {
    const s = srv({ demoHost: 'demos.mon-saas.fr', demoBaseUrl: 'https://demos.mon-saas.fr' });
    expect(buildDemoUrl('plombier-lyon', s)).toBe('https://demos.mon-saas.fr/plombier-lyon');
  });

  it('DEMO_BASE_URL seul (sans réécriture) : garde /demos', () => {
    const s = srv({ demoBaseUrl: 'https://demos.mon-saas.fr' });
    expect(buildDemoUrl('plombier-lyon', s)).toBe('https://demos.mon-saas.fr/demos/plombier-lyon');
  });

  it('ne produit jamais de double slash', () => {
    const s = srv({ baseUrl: 'https://mon-saas.fr/' });
    expect(buildDemoUrl('x', s)).toBe('https://mon-saas.fr/demos/x');
    const s2 = srv({ demoHost: 'd.fr', demoBaseUrl: 'https://d.fr/' });
    expect(buildDemoUrl('x', s2)).toBe('https://d.fr/x');
  });
});

describe('usesDemoHost', () => {
  it("n'est actif que si les deux variables sont posées", () => {
    expect(usesDemoHost(srv())).toBe(false);
    expect(usesDemoHost(srv({ demoHost: 'd.fr' }))).toBe(false);
    expect(usesDemoHost(srv({ demoBaseUrl: 'https://d.fr' }))).toBe(false);
    expect(usesDemoHost(srv({ demoHost: 'd.fr', demoBaseUrl: 'https://d.fr' }))).toBe(true);
  });
});
