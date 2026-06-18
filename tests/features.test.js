import { describe, it, expect } from 'vitest';
import { extractEmail }        from '../src/services/enrichmentService.js';
import { extractEmailAddress } from '../src/services/inboundService.js';
import { isMachineOpen }       from '../src/services/trackingService.js';
import { computeWarmupCap, pickChannel } from '../src/services/sequenceService.js';

describe('enrichment · extractEmail', () => {
  it('trouve un email plausible dans du HTML', () => {
    expect(extractEmail('<a href="mailto:contact@plombier-lyon.fr">nous écrire</a>')).toBe('contact@plombier-lyon.fr');
  });
  it('ignore les fichiers image et placeholders', () => {
    expect(extractEmail('<img src="logo@2x.png"> rien ici')).toBeNull();
    expect(extractEmail('no-reply@x.fr puis vrai@boite.fr')).toBe('vrai@boite.fr');
  });
  it('renvoie null sans email', () => {
    expect(extractEmail('aucune adresse')).toBeNull();
    expect(extractEmail(null)).toBeNull();
  });
});

describe('inbound · extractEmailAddress', () => {
  it('extrait depuis "Nom <email>"', () => {
    expect(extractEmailAddress('Jean Dupont <jean@garage.fr>')).toBe('jean@garage.fr');
  });
  it('accepte une adresse nue et normalise la casse', () => {
    expect(extractEmailAddress('Jean@Garage.FR')).toBe('jean@garage.fr');
  });
  it('renvoie null si invalide', () => {
    expect(extractEmailAddress('pas un email')).toBeNull();
    expect(extractEmailAddress(null)).toBeNull();
  });
});

describe('tracking · isMachineOpen (APMP)', () => {
  const sentAt = '2026-06-13T10:00:00.000Z';
  it('ouverture quasi-immédiate = machine (prefetch)', () => {
    expect(isMachineOpen({ sentAt, openAt: '2026-06-13T10:00:03.000Z', prefetchSeconds: 10 })).toBe(true);
  });
  it('ouverture tardive = humaine', () => {
    expect(isMachineOpen({ sentAt, openAt: '2026-06-13T10:05:00.000Z', prefetchSeconds: 10 })).toBe(false);
  });
  it('UA proxy connu = machine', () => {
    expect(isMachineOpen({ sentAt, openAt: '2026-06-13T11:00:00.000Z', userAgent: 'GoogleImageProxy' })).toBe(true);
  });
  it('sans date d\'envoi = non machine', () => {
    expect(isMachineOpen({ sentAt: null, userAgent: 'Mozilla' })).toBe(false);
  });
});

describe('warmup · computeWarmupCap', () => {
  const w = { enabled: true, startPerDay: 20, incrementPerDay: 20, maxPerDay: 200 };
  it('désactivé → illimité', () => {
    expect(computeWarmupCap({ ...w, enabled: false }, 100)).toBe(Infinity);
  });
  it('jour 0 = départ', () => {
    expect(computeWarmupCap(w, 0)).toBe(20);
  });
  it('monte avec les jours', () => {
    expect(computeWarmupCap(w, 3)).toBe(80);
  });
  it('plafonné au max', () => {
    expect(computeWarmupCap(w, 100)).toBe(200);
  });
});

describe('séquence · pickChannel', () => {
  it('email si adresse présente', () => {
    expect(pickChannel({ email: 'a@b.fr', phone: '0612345678' })).toBe('email');
  });
  it('null si pas d\'email et WhatsApp désactivé (défaut)', () => {
    expect(pickChannel({ phone: '0612345678' })).toBeNull();
  });
  it('null si ni email ni téléphone', () => {
    expect(pickChannel({})).toBeNull();
  });
});
