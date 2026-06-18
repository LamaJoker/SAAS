import { describe, it, expect } from 'vitest';
import { buildCrmToken, verifyCrmToken } from '../src/utils/crmToken.js';

describe('crmToken', () => {
  it('construit puis vérifie un token valide', () => {
    const token = buildCrmToken('lead-123', 'converti');
    expect(verifyCrmToken(token)).toEqual({ leadId: 'lead-123', action: 'converti' });
  });

  it('rejette une signature forgée', () => {
    const token = buildCrmToken('lead-123', 'converti');
    const [payload] = token.split('.');
    expect(verifyCrmToken(`${payload}.aaaaaaaaaaaaaaaa`)).toBeNull();
  });

  it('rejette un payload altéré (changement d\'action)', () => {
    const token = buildCrmToken('lead-123', 'perdu');
    const sig   = token.split('.')[1];
    const forged = Buffer.from(`lead-123:converti:${Date.now() + 86_400_000}`).toString('base64url');
    expect(verifyCrmToken(`${forged}.${sig}`)).toBeNull();
  });

  it('rejette un token expiré', () => {
    const token = buildCrmToken('lead-123', 'contacte', -1); // TTL négatif = déjà expiré
    expect(verifyCrmToken(token)).toBeNull();
  });

  it('refuse de construire une action inconnue', () => {
    expect(() => buildCrmToken('lead-123', 'hack')).toThrow(/invalide/);
  });

  it('rejette les entrées dégénérées', () => {
    expect(verifyCrmToken(null)).toBeNull();
    expect(verifyCrmToken('')).toBeNull();
    expect(verifyCrmToken('sanspoint')).toBeNull();
    expect(verifyCrmToken('a'.repeat(600))).toBeNull();
  });
});
