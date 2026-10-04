/**
 * Traitement des événements Stripe. Les crédits ne sont versés qu'une fois
 * l'argent acquis : un paiement différé (SEPA) finalise la session Checkout
 * avec payment_status = 'unpaid', les fonds arrivent — ou non — plus tard.
 */
import { beforeAll, describe, it, expect } from 'vitest';
import { randomUUID } from 'crypto';
import { runMigrations, getDb } from '../src/db/database.js';
import { handleStripeEvent, CREDIT_PACKS } from '../src/api/routes/billing.js';

beforeAll(() => { runMigrations(); });

function seedUser() {
  const id = randomUUID();
  getDb().prepare('INSERT INTO users (id, email, credits) VALUES (?, ?, 0)').run(id, `${id}@test.fr`);
  return id;
}
const creditsOf  = (id) => getDb().prepare('SELECT credits FROM users WHERE id = ?').get(id).credits;
const invoicesOf = (id) => getDb().prepare('SELECT amount_ttc FROM invoices WHERE user_id = ?').all(id);

function sessionEvent(type, userId, { paymentStatus, amountTotal } = {}) {
  return {
    id: `evt_${randomUUID().replace(/-/g, '')}`,
    type,
    data: { object: {
      id: 'cs_test_1', customer: 'cus_test_1',
      payment_status: paymentStatus, amount_total: amountTotal,
      metadata: { kind: 'pack', userId, packId: 'starter', credits: String(CREDIT_PACKS.starter.credits) },
    } },
  };
}

describe('webhook Stripe — packs de crédits', () => {
  it('paiement immédiat : crédite et facture une fois, rejeu sans effet', async () => {
    const userId = seedUser();
    const event = sessionEvent('checkout.session.completed', userId, { paymentStatus: 'paid', amountTotal: 900 });
    await handleStripeEvent(event);
    await handleStripeEvent(event);
    expect(creditsOf(userId)).toBe(20);
    expect(invoicesOf(userId)).toHaveLength(1);
  });

  it('paiement différé : rien à la finalisation, crédit à la confirmation des fonds', async () => {
    const userId = seedUser();
    await handleStripeEvent(sessionEvent('checkout.session.completed', userId, { paymentStatus: 'unpaid' }));
    expect(creditsOf(userId)).toBe(0);
    expect(invoicesOf(userId)).toHaveLength(0);

    await handleStripeEvent(sessionEvent('checkout.session.async_payment_succeeded', userId, { paymentStatus: 'paid', amountTotal: 900 }));
    expect(creditsOf(userId)).toBe(20);
    expect(invoicesOf(userId)).toHaveLength(1);
  });

  it('paiement différé refusé : aucun crédit', async () => {
    const userId = seedUser();
    await handleStripeEvent(sessionEvent('checkout.session.completed', userId, { paymentStatus: 'unpaid' }));
    await handleStripeEvent(sessionEvent('checkout.session.async_payment_failed', userId, { paymentStatus: 'unpaid' }));
    expect(creditsOf(userId)).toBe(0);
  });

  it('la facture porte le montant encaissé (coupon), pas le prix catalogue', async () => {
    const userId = seedUser();
    await handleStripeEvent(sessionEvent('checkout.session.completed', userId, { paymentStatus: 'paid', amountTotal: 450 }));
    expect(invoicesOf(userId)[0].amount_ttc).toBe(450);
  });
});
