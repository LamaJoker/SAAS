import { describe, it, expect } from 'vitest';
import { hashPassword, verifyPassword, validatePasswordStrength } from '../src/utils/password.js';

describe('password', () => {
  it('hash puis vérifie un mot de passe correct', async () => {
    const hash = await hashPassword('monSuperMotDePasse');
    expect(hash).toMatch(/^scrypt:[0-9a-f]{32}:[0-9a-f]{128}$/);
    expect(await verifyPassword('monSuperMotDePasse', hash)).toBe(true);
  });

  it('rejette un mauvais mot de passe', async () => {
    const hash = await hashPassword('correct');
    expect(await verifyPassword('incorrect', hash)).toBe(false);
  });

  it('produit des hashs différents pour le même mot de passe (salt aléatoire)', async () => {
    const h1 = await hashPassword('pareil');
    const h2 = await hashPassword('pareil');
    expect(h1).not.toBe(h2);
  });

  it('rejette les hashs malformés sans crasher', async () => {
    expect(await verifyPassword('x', null)).toBe(false);
    expect(await verifyPassword('x', '')).toBe(false);
    expect(await verifyPassword('x', 'bcrypt:abc:def')).toBe(false);
    expect(await verifyPassword('x', 'pasunhash')).toBe(false);
  });

  it('valide la politique de mot de passe', () => {
    expect(validatePasswordStrength('court')).toBeTruthy();
    expect(validatePasswordStrength('a'.repeat(129))).toBeTruthy();
    expect(validatePasswordStrength(12345678)).toBeTruthy();
    expect(validatePasswordStrength('motdepasse-ok')).toBeNull();
  });
});
