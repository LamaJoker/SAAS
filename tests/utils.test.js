import { describe, it, expect } from 'vitest';
import { slugify, sanitize, sanitizeInput, generateSlug, withRetry } from '../src/utils/utils.js';

describe('slugify', () => {
  it('normalise accents, espaces et caractères spéciaux', () => {
    expect(slugify('Café de l\'Église')).toBe('cafe-de-leglise');
    expect(slugify('  Plombier   Lyon  ')).toBe('plombier-lyon');
    expect(slugify('Über <script>')).toBe('uber-script');
  });
  it('gère les entrées invalides', () => {
    expect(slugify(null)).toBe('');
    expect(slugify(42)).toBe('');
  });
});

describe('sanitize', () => {
  it('échappe le HTML', () => {
    expect(sanitize('<img src=x onerror=alert(1)>')).toBe('&lt;img src=x onerror=alert(1)&gt;');
    expect(sanitize(`"quotes" & 'apostrophes'`)).toBe('&quot;quotes&quot; &amp; &#x27;apostrophes&#x27;');
  });
});

describe('sanitizeInput', () => {
  it('retire les caractères dangereux et tronque', () => {
    expect(sanitizeInput('<b>Nom</b>')).toBe('bNom/b');
    expect(sanitizeInput('a'.repeat(300), 10)).toBe('a'.repeat(10));
  });
});

describe('generateSlug', () => {
  it('produit un slug stable pour un même lead', () => {
    const lead = { name: 'Garage Martin', city: 'Lyon', id: 'abc-123' };
    expect(generateSlug(lead)).toBe(generateSlug(lead));
    expect(generateSlug(lead)).toMatch(/^garage-martin-lyon-demo-[0-9a-f]{8}$/);
  });
  it('différencie deux leads homonymes par leur id', () => {
    const a = generateSlug({ name: 'Dupont', city: 'Paris', id: '1' });
    const b = generateSlug({ name: 'Dupont', city: 'Paris', id: '2' });
    expect(a).not.toBe(b);
  });
});

describe('withRetry', () => {
  it('retourne au premier succès', async () => {
    let calls = 0;
    const result = await withRetry(async () => { calls++; return 'ok'; }, 3, 1);
    expect(result).toBe('ok');
    expect(calls).toBe(1);
  });
  it('réessaie puis réussit', async () => {
    let calls = 0;
    const result = await withRetry(async () => {
      if (++calls < 3) throw new Error('boom');
      return 'ok';
    }, 3, 1);
    expect(result).toBe('ok');
    expect(calls).toBe(3);
  });
  it('propage la dernière erreur après épuisement', async () => {
    await expect(withRetry(async () => { throw new Error('fatal'); }, 2, 1))
      .rejects.toThrow('fatal');
  });
});
