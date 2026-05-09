const express = require('express');
const auth = require('../middleware/auth');
const User = require('../models/User');
const ServiceRequest = require('../models/ServiceRequest');
const Coupon = require('../models/Coupon');
const CouponRedemption = require('../models/CouponRedemption');
const PricingConfig = require('../models/PricingConfig');
const StripeConfig = require('../models/StripeConfig');
const { dispatchToNextProfessional } = require('../utils/requestQueue');
const { resolveCouponsForCheckout } = require('../services/couponService');

const router = express.Router();

// Retorna cliente Stripe instanciado com a chave do modo atual
async function getStripe() {
  const config = await StripeConfig.getSingleton();
  const key = config.mode === 'production'
    ? process.env.STRIPE_SECRET_KEY_PROD
    : (process.env.STRIPE_SECRET_KEY_TEST || process.env.STRIPE_SECRET_KEY);
  if (!key) throw new Error('Chave Stripe não configurada para o modo ' + config.mode);
  return require('stripe')(key);
}

// Retorna a chave publicável do modo atual
async function getPublishableKey() {
  const config = await StripeConfig.getSingleton();
  return config.mode === 'production'
    ? process.env.STRIPE_PUBLISHABLE_KEY_PROD
    : (process.env.STRIPE_PUBLISHABLE_KEY_TEST || process.env.STRIPE_SECRET_KEY?.replace('sk_', 'pk_'));
}

// ── ENDPOINT PÚBLICO — mobile busca a chave e modo atual ──────────
// GET /api/payments/config
router.get('/config', async (req, res) => {
  try {
    const [config, publishableKey] = await Promise.all([
      StripeConfig.getSingleton(),
      getPublishableKey(),
    ]);
    res.json({ mode: config.mode, publishableKey });
  } catch (err) {
    res.status(500).json({ message: 'Erro ao buscar configuração de pagamento' });
  }
});

// ── HELPERS ──────────────────────────────────────────────────────────

async function getOrCreateCustomer(user) {
  if (user.stripeCustomerId) return user.stripeCustomerId;
  const stripe = await getStripe();
  const customer = await stripe.customers.create({
    email: user.email,
    name: user.name,
    phone: user.phone,
    metadata: { userId: user._id.toString() },
  });
  user.stripeCustomerId = customer.id;
  await user.save();
  return customer.id;
}

async function calculatePricing(hours, hasProducts, serviceTypeSlug = null) {
  const cfg = await PricingConfig.getSingleton();
  const serviceBasePrices = cfg.serviceBasePrices instanceof Map
    ? Object.fromEntries(cfg.serviceBasePrices)
    : (cfg.serviceBasePrices || {});
  const serviceBase = serviceTypeSlug && serviceBasePrices[serviceTypeSlug] !== undefined
    ? Number(serviceBasePrices[serviceTypeSlug])
    : null;

  let pricePerHour = Number.isFinite(serviceBase) ? serviceBase : cfg.basePricePerHour;
  if (!hasProducts) pricePerHour += cfg.productsSurcharge;
  const estimated = pricePerHour * hours;
  const platformFee = (estimated * cfg.platformFeePercent) / 100;
  return { pricePerHour, estimated, platformFee, amountCents: Math.round(estimated * 100) };
}

function parseCouponMeta(rawCodes, rawDiscounts) {
  const codes = String(rawCodes || '')
    .split(',')
    .map((c) => c.trim())
    .filter(Boolean);
  const discounts = String(rawDiscounts || '')
    .split(',')
    .map((d) => Number(d));

  return codes.map((code, idx) => ({
    code,
    discountAmount: Number.isFinite(discounts[idx]) ? discounts[idx] : 0,
  }));
}

// Cria o ServiceRequest a partir dos metadados do PaymentIntent (idempotente)
async function createRequestFromIntent(intent, io) {
  const existing = await ServiceRequest.findOne({ 'payment.transactionId': intent.id });
  if (existing) return existing;
  if (!intent.metadata?.clientId) return null;

  const m = intent.metadata;
  const address = JSON.parse(m.address);
  const hasProducts = m.hasProducts === 'true';
  const serviceTypeSlug = m.serviceTypeSlug || null;
  const { pricePerHour, estimated, platformFee } = await calculatePricing(parseInt(m.hours), hasProducts, serviceTypeSlug);
  const couponsMeta = parseCouponMeta(m.couponCodes, m.couponDiscounts);
  const discountTotal = couponsMeta.reduce((sum, c) => sum + Number(c.discountAmount || 0), 0);
  const finalEstimated = Math.max(0, estimated - discountTotal);
  const couponDocs = await Coupon.find({ code: { $in: couponsMeta.map((c) => c.code) } }).select('_id code');
  const couponByCode = new Map(couponDocs.map((c) => [c.code, c]));

  const request = await ServiceRequest.create({
    client: m.clientId,
    serviceTypeSlug,
    details: {
      hours: parseInt(m.hours),
      rooms: parseInt(m.rooms),
      bathrooms: parseInt(m.bathrooms),
      hasProducts,
      notes: m.notes,
      scheduledDate: m.scheduledDate,
    },
    address,
    pricing: {
      pricePerHour,
      estimated: finalEstimated,
      discountTotal,
      appliedCoupons: couponsMeta.map((c) => c.code),
      platformFee,
    },
    payment: {
      status: 'paid',
      method: intent.payment_method_types?.[0] || 'card',
      transactionId: intent.id,
      paidAt: new Date(),
    },
  });

  if (couponsMeta.length) {
    const redemptions = couponsMeta
      .filter((coupon) => couponByCode.has(coupon.code))
      .map((coupon) => ({
      updateOne: {
        filter: { paymentIntentId: intent.id, coupon: couponByCode.get(coupon.code)._id },
        update: {
          $setOnInsert: {
            coupon: couponByCode.get(coupon.code)._id,
            user: m.clientId,
            serviceRequest: request._id,
            paymentIntentId: intent.id,
            couponCodeSnapshot: coupon.code,
            discountAmount: coupon.discountAmount,
          },
        },
        upsert: true,
      },
    }));
    if (redemptions.length) {
      await CouponRedemption.bulkWrite(redemptions, { ordered: false });
    }
  }

  if (io) dispatchToNextProfessional(request._id, io);
  return request;
}

// ── ROTAS ─────────────────────────────────────────────────────────────

// POST /api/payments/create-intent
// Cria PaymentIntent + EphemeralKey para o Payment Sheet do Stripe
router.post('/create-intent', auth, async (req, res) => {
  if (req.user.userType !== 'client') {
    return res.status(403).json({ message: 'Apenas clientes podem fazer pagamentos' });
  }

  const {
    hours,
    hasProducts,
    rooms,
    bathrooms,
    notes,
    address,
    scheduledDate,
    serviceTypeSlug,
    couponCodes,
  } = req.body;
  if (!hours || !address?.street || !address?.city || !scheduledDate) {
    return res.status(400).json({ message: 'Dados do pedido incompletos' });
  }

  try {
    const { amountCents, estimated } = await calculatePricing(hours, !!hasProducts, serviceTypeSlug || null);
    const checkout = await resolveCouponsForCheckout({
      couponCodes,
      user: req.user,
      orderSubtotal: estimated,
    });
    const finalAmount = checkout.pricing.finalTotal;
    const finalAmountCents = Math.round(finalAmount * 100);
    const user = await User.findById(req.user._id);
    const stripe = await getStripe();
    const customerId = await getOrCreateCustomer(user);

    // Atualizar CPF no Customer do Stripe (exigido para PIX)
    if (user.cpf) {
      try {
        await stripe.customers.update(customerId, {
          tax_id_data: [{ type: 'br_cpf', value: user.cpf.replace(/\D/g, '') }],
        });
      } catch {
        // Ignora erro se CPF já foi cadastrado antes
      }
    }

    const [intent, ephemeralKey] = await Promise.all([
      stripe.paymentIntents.create({
        amount: finalAmountCents,
        currency: 'brl',
        customer: customerId,
        automatic_payment_methods: { enabled: true, allow_redirects: 'never' },
        payment_method_options: {
          card: { setup_future_usage: 'off_session' },
        },
        metadata: {
          clientId: req.user._id.toString(),
          hours: String(hours),
          hasProducts: String(!!hasProducts),
          rooms: String(rooms || 1),
          bathrooms: String(bathrooms || 1),
          notes: notes || '',
          scheduledDate,
          serviceTypeSlug: serviceTypeSlug || '',
          couponCodes: checkout.pricing.appliedCoupons.map((c) => c.code).join(','),
          couponDiscounts: checkout.pricing.appliedCoupons.map((c) => String(c.discountAmount)).join(','),
          address: JSON.stringify(address),
        },
      }),
      stripe.ephemeralKeys.create(
        { customer: customerId },
        { apiVersion: '2024-06-20' }
      ),
    ]);

    res.json({
      clientSecret: intent.client_secret,
      paymentIntentId: intent.id,
      ephemeralKey: ephemeralKey.secret,
      customerId,
      amount: finalAmount,
      subtotal: estimated,
      discountTotal: checkout.pricing.totalDiscount,
      appliedCoupons: checkout.pricing.appliedCoupons,
      rejectedCoupons: checkout.rejectedCoupons,
    });
  } catch (err) {
    console.error('Stripe create-intent error:', err);
    res.status(500).json({ message: 'Erro ao iniciar pagamento: ' + err.message });
  }
});

// POST /api/payments/preview
// Pré-visualiza o total com cupons antes de abrir o Payment Sheet
router.post('/preview', auth, async (req, res) => {
  if (req.user.userType !== 'client') {
    return res.status(403).json({ message: 'Apenas clientes podem simular pagamento' });
  }

  const { hours, hasProducts, serviceTypeSlug, couponCodes } = req.body;
  if (!hours) return res.status(400).json({ message: 'hours é obrigatório' });

  try {
    const { estimated } = await calculatePricing(hours, !!hasProducts, serviceTypeSlug || null);
    const checkout = await resolveCouponsForCheckout({
      couponCodes,
      user: req.user,
      orderSubtotal: estimated,
    });

    res.json({
      subtotal: estimated,
      discountTotal: checkout.pricing.totalDiscount,
      total: checkout.pricing.finalTotal,
      appliedCoupons: checkout.pricing.appliedCoupons,
      rejectedCoupons: checkout.rejectedCoupons,
    });
  } catch {
    res.status(500).json({ message: 'Erro ao simular pagamento com cupons' });
  }
});

// POST /api/payments/confirm
// Chamado pelo app após confirmação bem-sucedida no Payment Sheet (cartão/débito)
// Verifica o PaymentIntent no Stripe e cria o ServiceRequest
router.post('/confirm', auth, async (req, res) => {
  const { paymentIntentId } = req.body;
  if (!paymentIntentId) return res.status(400).json({ message: 'paymentIntentId obrigatório' });

  try {
    const stripe = await getStripe();
    const intent = await stripe.paymentIntents.retrieve(paymentIntentId);
    const user = await User.findById(req.user._id);

    if (intent.customer !== user.stripeCustomerId) {
      return res.status(403).json({ message: 'Acesso negado' });
    }
    if (intent.status !== 'succeeded') {
      return res.status(400).json({ message: `Pagamento não aprovado (${intent.status})` });
    }

    const io = req.app.get('io');
    const request = await createRequestFromIntent(intent, io);
    if (!request) return res.status(400).json({ message: 'Erro ao processar pedido' });

    res.status(201).json({ request });
  } catch (err) {
    console.error('Confirm payment error:', err);
    res.status(500).json({ message: 'Erro ao confirmar pagamento' });
  }
});

// GET /api/payments/methods
// Lista cartões salvos do cliente (carteira)
router.get('/methods', auth, async (req, res) => {
  try {
    const user = await User.findById(req.user._id);
    if (!user.stripeCustomerId) return res.json({ methods: [] });

    const stripe = await getStripe();
    const [methods, customer] = await Promise.all([
      stripe.paymentMethods.list({ customer: user.stripeCustomerId, type: 'card' }),
      stripe.customers.retrieve(user.stripeCustomerId),
    ]);

    const defaultPmId = customer.invoice_settings?.default_payment_method;
    res.json({
      methods: methods.data.map((pm) => ({
        id: pm.id,
        brand: pm.card.brand,
        last4: pm.card.last4,
        expMonth: pm.card.exp_month,
        expYear: pm.card.exp_year,
        isDefault: pm.id === defaultPmId,
      })),
    });
  } catch (err) {
    res.status(500).json({ message: 'Erro ao listar cartões' });
  }
});

// DELETE /api/payments/methods/:id
// Remove um cartão da carteira
router.delete('/methods/:id', auth, async (req, res) => {
  try {
    const user = await User.findById(req.user._id);
    const stripe = await getStripe();
    const method = await stripe.paymentMethods.retrieve(req.params.id);
    if (method.customer !== user.stripeCustomerId) {
      return res.status(403).json({ message: 'Cartão não pertence a este usuário' });
    }
    await stripe.paymentMethods.detach(req.params.id);
    res.json({ message: 'Cartão removido com sucesso' });
  } catch (err) {
    res.status(500).json({ message: 'Erro ao remover cartão' });
  }
});

// PATCH /api/payments/methods/:id/default
// Define cartão padrão
router.patch('/methods/:id/default', auth, async (req, res) => {
  try {
    const user = await User.findById(req.user._id);
    const stripe = await getStripe();
    const method = await stripe.paymentMethods.retrieve(req.params.id);
    if (method.customer !== user.stripeCustomerId) {
      return res.status(403).json({ message: 'Cartão não pertence a este usuário' });
    }
    await stripe.customers.update(user.stripeCustomerId, {
      invoice_settings: { default_payment_method: req.params.id },
    });
    res.json({ message: 'Cartão padrão atualizado' });
  } catch (err) {
    res.status(500).json({ message: 'Erro ao atualizar cartão padrão' });
  }
});

// POST /api/payments/webhook
// Webhook do Stripe para eventos assíncronos (principalmente PIX)
// ATENÇÃO: express.raw() é aplicado em app.js ANTES do express.json() para esta rota
router.post('/webhook', async (req, res) => {
  const sig = req.headers['stripe-signature'];

  let event;
  try {
    const stripe = await getStripe();
    const config = await StripeConfig.getSingleton();
    const webhookSecret = config.mode === 'production'
      ? (process.env.STRIPE_WEBHOOK_SECRET_PROD || process.env.STRIPE_WEBHOOK_SECRET)
      : (process.env.STRIPE_WEBHOOK_SECRET_TEST || process.env.STRIPE_WEBHOOK_SECRET);

    if (webhookSecret) {
      event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
    } else {
      event = JSON.parse(req.body.toString());
    }
  } catch (err) {
    console.error('Webhook signature error:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  if (event.type === 'payment_intent.succeeded') {
    const intent = event.data.object;
    try {
      const io = req.app.get('io');
      const request = await createRequestFromIntent(intent, io);
      if (request) {
        console.log(`✅ Webhook: ServiceRequest ${request._id} criado (intent ${intent.id})`);
      }
    } catch (err) {
      console.error('Webhook create request error:', err);
    }
  }

  res.json({ received: true });
});

module.exports = router;
