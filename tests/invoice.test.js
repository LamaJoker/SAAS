import { beforeAll, describe, it, expect } from 'vitest';
import { runMigrations } from '../src/db/database.js';
import { User } from '../src/db/models/User.js';
import { computeVat, createInvoice, listInvoices, renderInvoiceHTML } from '../src/services/invoiceService.js';

beforeAll(() => runMigrations());

describe('computeVat', () => {
  it('domestique FR : TVA 20 % incluse, HT calculé', () => {
    const v = computeVat({ amountTtc: 1200, sellerCountry: 'FR', buyerCountry: 'FR', defaultRate: 20 });
    expect(v.rate).toBe(20);
    expect(v.ht).toBe(1000);     // 1200 / 1.2
    expect(v.vat).toBe(200);
    expect(v.ttc).toBe(1200);
    expect(v.note).toBe('');
  });

  it('UE avec n° TVA → autoliquidation (0 %)', () => {
    const v = computeVat({ amountTtc: 1200, sellerCountry: 'FR', buyerCountry: 'DE', buyerVat: 'DE123456789' });
    expect(v.rate).toBe(0);
    expect(v.vat).toBe(0);
    expect(v.ht).toBe(1200);
    expect(v.note).toMatch(/autoliquidation/i);
  });

  it('UE sans n° TVA → taux domestique (B2C)', () => {
    const v = computeVat({ amountTtc: 1200, sellerCountry: 'FR', buyerCountry: 'DE', buyerVat: null, defaultRate: 20 });
    expect(v.rate).toBe(20);
  });

  it('hors UE → exonération export (0 %)', () => {
    const v = computeVat({ amountTtc: 1000, sellerCountry: 'FR', buyerCountry: 'US' });
    expect(v.rate).toBe(0);
    expect(v.note).toMatch(/exonération/i);
  });

  it('pays acheteur inconnu → taux domestique', () => {
    const v = computeVat({ amountTtc: 1000, sellerCountry: 'FR', buyerCountry: null, defaultRate: 20 });
    expect(v.rate).toBe(20);
  });
});

describe('createInvoice', () => {
  it('numérote séquentiellement et fige les montants', () => {
    const u = User.create({ email: `inv-${Date.now()}@test.fr`, name: 'Client SARL', passwordHash: 'x' });
    User.updateBilling(u.id, { billing_name: 'Client SARL', billing_country: 'FR' });
    const user = User.findById(u.id);

    const a = createInvoice({ user, type: 'pack', description: '100 crédits', amountTtc: 2900 });
    const b = createInvoice({ user, type: 'pack', description: '20 crédits',  amountTtc: 900 });

    expect(a.number).toMatch(/^FACT-\d{4}-\d{4}$/);
    // séquence : b vient juste après a
    const na = parseInt(a.number.slice(-4), 10);
    const nb = parseInt(b.number.slice(-4), 10);
    expect(nb).toBe(na + 1);

    expect(a.amount_ttc).toBe(2900);
    expect(a.vat_rate).toBe(20);
    expect(a.amount_ht + a.vat_amount).toBe(a.amount_ttc);

    const list = listInvoices(u.id);
    expect(list.length).toBe(2);
  });

  it('rend une facture HTML imprimable', () => {
    const u = User.create({ email: `inv2-${Date.now()}@test.fr`, name: 'Acme', passwordHash: 'x' });
    const inv = createInvoice({ user: User.findById(u.id), type: 'subscription', description: 'Abonnement Pro', amountTtc: 4900 });
    const html = renderInvoiceHTML(inv);
    expect(html).toContain(inv.number);
    expect(html).toContain('FACTURE');
    expect(html).toContain('49.00 €');
  });
});
