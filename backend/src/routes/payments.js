const express = require('express');
const auth = require('../middleware/auth');
const User = require('../models/User');
const ServiceRequest = require('../models/ServiceRequest');
const PricingConfig = require('../models/PricingConfig');
const { dispatchToNextProfessional } = require('../utils/requestQueue');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

const router = express.Router();

// ── HELPERS ──────────────────────────────────────────────────────────

async function getOrCreateCustomer(user) {
  if (user.stripeCustomerId) return user.stripeCustomerId;
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

async function calculatePricing(hours, hasProducts) {
  const cfg = await PricingConfig.getSingleton();
  let pricePerHour = cfg.basePricePerHour;
  if (!hasProducts) pricePerHour += cfg.productsSurcharge;
  const estimated = pricePerHour * hours;
  const platformFee = (estimated * cfg.platformFeePercent) / 100;
  return { pricePerHour, estimated, platformFee, amountCents: Math.round(estimated * 100) };
}

// Cria o ServiceRequest a partir dos metadados do PaymentIntent (idempotente)
async function createRequestFromIntent(intent, io) {
  const existing = await ServiceRequest.findOne({ 'payment.transactionId': intent.id });
  if (existing) return existing;
  if (!intent.metadata?.clientId) return null;

  const m = intent.metadata;
  const address = JSON.parse(m.address);
  const hasProducts = m.hasProducts === 'true';
  const { pricePerHour, estimated, platformFee } = await calculatePricing(parseInt(m.hours), hasProducts);

  const request = await ServiceRequest.create({
    client: m.clientId,
    details: {
      hours: parseInt(m.hours),
      rooms: parseInt(m.rooms),
      bathrooms: parseInt(m.bathrooms),
      hasProducts,
      notes: m.notes,
      scheduledDate: m.scheduledDate,
    },
    address,
    pricing: { pricePerHour, estimated, platformFee },
    payment: {
      status: 'paid',
      method: intent.payment_method_types?.[0] || 'card',
      transactionId: intent.id,
      paidAt: new Date(),
    },
  });

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

  const { hours, hasProducts, rooms, bathrooms, notes, address, scheduledDate } = req.body;
  if (!hours || !address?.street || !address?.city || !scheduledDate) {
    return res.status(400).json({ message: 'Dados do pedido incompletos' });
  }

  try {
    const { amountCents, estimated } = await calculatePricing(hours, !!hasProducts);
    const user = await User.findById(req.user._id);
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
        amount: amountCents,
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
      amount: estimated,
    });
  } catch (err) {
    console.error('Stripe create-intent error:', err);
    res.status(500).json({ message: 'Erro ao iniciar pagamento: ' + err.message });
  }
});

// POST /api/payments/confirm
// Chamado pelo app após confirmação bem-sucedida no Payment Sheet (cartão/débito)
// Verifica o PaymentIntent no Stripe e cria o ServiceRequest
router.post('/confirm', auth, async (req, res) => {
  const { paymentIntentId } = req.body;
  if (!paymentIntentId) return res.status(400).json({ message: 'paymentIntentId obrigatório' });

  try {
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
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  let event;
  try {
    if (webhookSecret) {
      event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
    } else {
      // Em desenvolvimento sem webhook secret configurado, aceita o evento direto
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
