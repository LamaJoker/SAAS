import { describe, it, expect } from 'vitest';
import { isPersonalEmail } from '../src/services/sequenceService.js';

describe('isPersonalEmail', () => {
  it('détecte les adresses personnelles courantes', () => {
    expect(isPersonalEmail('jean@gmail.com')).toBe(true);
    expect(isPersonalEmail('marie@HOTMAIL.FR')).toBe(true);
    expect(isPersonalEmail('paul@orange.fr')).toBe(false); // orange.fr = souvent pro chez les artisans
    expect(isPersonalEmail('luc@laposte.net')).toBe(true);
    expect(isPersonalEmail('zoe@icloud.com')).toBe(true);
  });

  it('laisse passer les adresses professionnelles', () => {
    expect(isPersonalEmail('contact@plomberie-dupont.fr')).toBe(false);
    expect(isPersonalEmail('info@garage-martin.com')).toBe(false);
  });

  it('gère les entrées dégénérées', () => {
    expect(isPersonalEmail(null)).toBe(false);
    expect(isPersonalEmail('')).toBe(false);
    expect(isPersonalEmail('pasunemail')).toBe(false);
    expect(isPersonalEmail(42)).toBe(false);
  });
});
