import { describe, it, expect } from 'vitest';
import { buildUnsubToken, verifyUnsubToken } from '../src/utils/unsubToken.js';

describe('unsubToken', () => {
  it('construit puis vérifie un token valide', () => {
    const token = buildUnsubToken('Test@Example.com');
    expect(verifyUnsubToken(token)).toBe('test@example.com'); // normalisé minuscules
  });

  it('rejette un token sans signature', () => {
    const payload = Buffer.from('victime@gmail.com').toString('base64url');
    expect(verifyUnsubToken(payload)).toBeNull();
  });

  it('rejette une signature forgée', () => {
    const payload = Buffer.from('victime@gmail.com').toString('base64url');
    expect(verifyUnsubToken(`${payload}.aaaaaaaaaaaaaaaa`)).toBeNull();
  });

  it('rejette un token valide dont le payload a été altéré', () => {
    const token = buildUnsubToken('legitime@site.fr');
    const sig   = token.split('.')[1];
    const autre = Buffer.from('autre@site.fr').toString('base64url');
    expect(verifyUnsubToken(`${autre}.${sig}`)).toBeNull();
  });

  it('rejette les entrées dégénérées', () => {
    expect(verifyUnsubToken(null)).toBeNull();
    expect(verifyUnsubToken('')).toBeNull();
    expect(verifyUnsubToken('pasdepoint')).toBeNull();
    expect(verifyUnsubToken('a'.repeat(600))).toBeNull();
    // payload qui ne décode pas vers un email
    const notEmail = Buffer.from('pasunemail').toString('base64url');
    expect(verifyUnsubToken(buildUnsubToken('x@y.fr').replace(/^[^.]+/, notEmail))).toBeNull();
  });
});
