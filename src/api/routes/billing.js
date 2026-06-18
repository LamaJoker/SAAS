import express from 'express';
import { authenticate } from '../middleware/auth.js';
import { User }   from '../../db/models/User.js'; // sync, utilisé DANS la transaction du webhook
import { repo }   from '../../db/repo.js';        // async, hors transaction
import { getDb }  from '../../db/database.js';
import { Errors } from '../../utils/AppError.js';
import { logger } from '../../utils/logger.js';
import { config } from '../../config/config.js';
import { createInvoice, listInvoices, getInvoiceForUser, renderInvoiceHTML } from '../../services/invoiceService.js';

const router = express.Router();

/** Packs de crédits one-time. Prix en centimes TTC. 1 crédit = 1 site. */
export const CREDIT_PACKS = {
  starter: { id: 'starter', credits: 20,  price: 900,  label: 'Starter — 20 crédits' },
  pro:     { id: 'pro',     credits: 100, price: 2900, label: 'Pro — 100 crédits' },
  agence:  { id: 'agence',  credits: 500, price: 9900, label: 'Agence — 500 crédits' },
};

/** Abonnements mensuels : crédits rechargés à chaque cycle. Prix centimes TTC. */
export const SUBSCRIPTION_PLANS = {
  solo:   { id: 'solo',   credits: 30,  price: 1900,  label: 'Solo — 30 crédits/mois' },
  pro:    { id: 'pro',    credits: 150, price: 4900,  label: 'Pro — 150 crédits/mois' },
  agence: { id: 'agence', credits: 600, price: 14900, label: 'Agence — 600 crédits/mois' },
};

let stripeClient = null;
async function getStripe() {
  if (stripeClient) return stripeClient;
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return null;
  try {
    const Stripe = (await import('stripe')).default;
    stripeClient = new Stripe(key);
    return stripeClient;
  } catch {
    logger.warn('[Billing] Module stripe non installé — npm install stripe');
    return null;
  }
}

const withEur = (p) => ({ ...p, price_eur: (p.price / 100).toFixed(2) });

// ── Catalogues publics ──────────────────────────────────────────────────────
router.get('/packs', (req, res) =>
  res.json({ success: true, data: Object.values(CREDIT_PACKS).map(withEur) }));

router.get('/plans', (req, res) =>
  res.json({ success: true, data: Object.values(SUBSCRIPTION_PLANS).map(withEur) }));

// ── Coordonnées de facturation (déterminent la TVA) ─────────────────────────
router.post('/profile', authenticate, async (req, res, next) => {
  try {
    const country = (req.body.billing_country || '').toUpperCase();
    if (country && country.length !== 2) {
      return next(Errors.badRequest('billing_country doit être un code ISO2 (FR, DE, BE…)'));
    }
    const user = await repo.users.updateBilling(req.userId, {
      billing_name:    req.body.billing_name?.slice(0, 200),
      billing_address: req.body.billing_address?.slice(0, 400),
      billing_country: country,
      vat_number:      req.body.vat_number?.slice(0, 32),
    });
    res.json({ success: true, data: {
      billing_name: user.billing_name, billing_address: user.billing_address,
      billing_country: user.billing_country, vat_number: user.vat_number,
    }});
  } catch (err) { next(err); }
});

router.get('/profile', authenticate, async (req, res, next) => {
  try {
    const u = await repo.users.findById(req.userId);
    if (!u) return next(Errors.unauthorized());
    res.json({ success: true, data: {
      billing_name: u.billing_name, billing_address: u.billing_address,
      billing_country: u.billing_country, vat_number: u.vat_number,
      plan: u.plan, sub_status: u.sub_status, period_end: u.period_end,
    }});
  } catch (err) { next(err); }
});

// ── Achat pack one-time ─────────────────────────────────────────────────────
router.post('/checkout', authenticate, async (req, res, next) => {
  try {
    const pack = CREDIT_PACKS[req.body.pack];
    if (!pack) return next(Errors.badRequest(`Pack inconnu. Valeurs: ${Object.keys(CREDIT_PACKS).join(', ')}`));

    const stripe = await getStripe();
    if (!stripe) return next(Errors.badRequest('Paiement non configuré (STRIPE_SECRET_KEY manquant)'));

    const user = await repo.users.findById(req.userId);
    if (!user) return next(Errors.unauthorized());

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      customer: user.stripe_customer_id || undefined,
      customer_email: user.stripe_customer_id ? undefined : user.email,
      line_items: [{
        quantity: 1,
        price_data: {
          currency: 'eur', unit_amount: pack.price,
          product_data: { name: pack.label, description: `${pack.credits} générations de site` },
        },
      }],
      metadata: { kind: 'pack', userId: user.id, packId: pack.id, credits: String(pack.credits) },
      success_url: `${config.server.baseUrl}/dashboard.html?payment=success`,
      cancel_url:  `${config.server.baseUrl}/dashboard.html?payment=cancelled`,
    });
    res.json({ success: true, data: { url: session.url, sessionId: session.id } });
  } catch (err) { next(err); }
});

// ── Abonnement récurrent ────────────────────────────────────────────────────
router.post('/subscribe', authenticate, async (req, res, next) => {
  try {
    const plan = SUBSCRIPTION_PLANS[req.body.plan];
    if (!plan) return next(Errors.badRequest(`Plan inconnu. Valeurs: ${Object.keys(SUBSCRIPTION_PLANS).join(', ')}`));

    const stripe = await getStripe();
    if (!stripe) return next(Errors.badRequest('Paiement non configuré (STRIPE_SECRET_KEY manquant)'));

    const user = await repo.users.findById(req.userId);
    if (!user) return next(Errors.unauthorized());

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      customer: user.stripe_customer_id || undefined,
      customer_email: user.stripe_customer_id ? undefined : user.email,
      line_items: [{
        quantity: 1,
        price_data: {
          currency: 'eur', unit_amount: plan.price, recurring: { interval: 'month' },
          product_data: { name: `Abonnement ${plan.label}` },
        },
      }],
      metadata: { kind: 'subscription', userId: user.id, plan: plan.id, credits: String(plan.credits) },
      subscription_data: { metadata: { userId: user.id, plan: plan.id, credits: String(plan.credits) } },
      success_url: `${config.server.baseUrl}/dashboard.html?payment=success`,
      cancel_url:  `${config.server.baseUrl}/dashboard.html?payment=cancelled`,
    });
    res.json({ success: true, data: { url: session.url, sessionId: session.id } });
  } catch (err) { next(err); }
});

// ── Portail Stripe (gérer/annuler l'abonnement, moyen de paiement) ──────────
router.post('/portal', authenticate, async (req, res, next) => {
  try {
    const stripe = await getStripe();
    if (!stripe) return next(Errors.badRequest('Paiement non configuré'));
    const user = await repo.users.findById(req.userId);
    if (!user?.stripe_customer_id) return next(Errors.badRequest('Aucun abonnement actif'));
    const session = await stripe.billingPortal.sessions.create({
      customer: user.stripe_customer_id,
      return_url: `${config.server.baseUrl}/dashboard.html`,
    });
    res.json({ success: true, data: { url: session.url } });
  } catch (err) { next(err); }
});

// ── Factures ────────────────────────────────────────────────────────────────
router.get('/invoices', authenticate, (req, res, next) => {
  try {
    const rows = listInvoices(req.userId).map(i => ({
      id: i.id, number: i.number, type: i.type, description: i.description,
      amount_ttc_eur: (i.amount_ttc / 100).toFixed(2), vat_rate: i.vat_rate,
      issued_at: i.issued_at,
    }));
    res.json({ success: true, data: rows });
  } catch (err) { next(err); }
});

router.get('/invoices/:id', authenticate, (req, res, next) => {
  try {
    const inv = getInvoiceForUser(req.params.id, req.userId);
    if (!inv) return next(Errors.notFound('Facture introuvable'));
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(renderInvoiceHTML(inv));
  } catch (err) { next(err); }
});

// ── Webhook Stripe ──────────────────────────────────────────────────────────
// Crédite + émet une facture, de façon idempotente. Monté en express.raw()
// AVANT express.json() (cf. api/index.js) car la signature exige le corps brut.

// Crédite + facture en une transaction idempotente (event.id = clé). Renvoie
// la facture créée, ou null si l'event était déjà traité.
function applyPayment(db, { eventId, eventType, user, credits, type, description, amountTtc, stripeRef }) {
  return db.transaction(() => {
    const ins = db.prepare(
      'INSERT OR IGNORE INTO stripe_events (event_id, type, user_id, credits) VALUES (?,?,?,?)'
    ).run(eventId, eventType, user.id, credits);
    if (ins.changes === 0) return null;            // rejeu Stripe → no-op
    User.addCredits(user.id, credits);
    return createInvoice({ user, type, description, amountTtc, stripeRef }); // savepoint imbriqué
  })();
}

export async function stripeWebhookHandler(req, res) {
  const stripe = await getStripe();
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!stripe || !secret) return res.status(503).json({ success: false, error: 'Webhook non configuré' });

  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, req.headers['stripe-signature'], secret);
  } catch (err) {
    logger.warn('[Billing] Signature webhook invalide', { error: err.message });
    return res.status(400).json({ success: false, error: 'Signature invalide' });
  }

  const db = getDb();
  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const s = event.data.object;
        const userId = s.metadata?.userId;
        const user = userId && await repo.users.findById(userId);
        if (!user) break;

        // Mémorise le client Stripe pour les achats/portail futurs
        if (s.customer) await repo.users.setStripeCustomer(user.id, s.customer);

        const credits = parseInt(s.metadata?.credits, 10);
        if (!Number.isInteger(credits) || credits <= 0) break;

        if (s.metadata?.kind === 'subscription') {
          // 1er cycle : on active l'abonnement + crédite. Les renouvellements
          // suivants passent par invoice.paid (billing_reason=subscription_cycle).
          await repo.users.setSubscription(user.id, { plan: s.metadata.plan, status: 'active', periodEnd: null });
          const plan = SUBSCRIPTION_PLANS[s.metadata.plan];
          applyPayment(db, { eventId: event.id, eventType: event.type, user, credits,
            type: 'subscription', description: `Abonnement ${plan?.label ?? s.metadata.plan} — 1er mois`,
            amountTtc: plan?.price ?? 0, stripeRef: s.id });
        } else {
          const pack = CREDIT_PACKS[s.metadata.packId];
          applyPayment(db, { eventId: event.id, eventType: event.type, user, credits,
            type: 'pack', description: pack?.label ?? `${credits} crédits`,
            amountTtc: pack?.price ?? 0, stripeRef: s.id });
        }
        logger.info('[Billing] Paiement traité 💰', { eventId: event.id, userId: user.id, kind: s.metadata?.kind });
        break;
      }

      case 'invoice.paid': {
        const inv = event.data.object;
        // Uniquement les renouvellements : le 1er cycle est géré au checkout
        if (inv.billing_reason !== 'subscription_cycle') break;
        const user = inv.customer && await repo.users.findByStripeCustomer(inv.customer);
        if (!user) break;
        const plan = SUBSCRIPTION_PLANS[user.plan];
        if (!plan) break;
        if (inv.period_end) await repo.users.setSubscription(user.id, { plan: user.plan, status: 'active', periodEnd: new Date(inv.period_end * 1000).toISOString() });
        applyPayment(db, { eventId: event.id, eventType: event.type, user, credits: plan.credits,
          type: 'subscription', description: `Abonnement ${plan.label} — renouvellement`,
          amountTtc: plan.price, stripeRef: inv.id });
        logger.info('[Billing] Renouvellement abonnement', { eventId: event.id, userId: user.id });
        break;
      }

      case 'customer.subscription.updated':
      case 'customer.subscription.deleted': {
        const sub = event.data.object;
        const user = sub.customer && await repo.users.findByStripeCustomer(sub.customer);
        if (!user) break;
        const status = event.type.endsWith('deleted') ? 'canceled' : sub.status;
        await repo.users.setSubscription(user.id, {
          plan: user.plan, status,
          periodEnd: sub.current_period_end ? new Date(sub.current_period_end * 1000).toISOString() : user.period_end,
        });
        logger.info('[Billing] Abonnement mis à jour', { userId: user.id, status });
        break;
      }
    }
  } catch (err) {
    logger.error('[Billing] Erreur traitement webhook', { type: event.type, error: err.message });
    // 200 quand même : éviter une boucle de retries Stripe sur une erreur applicative
  }

  res.json({ received: true });
}

export default router;
