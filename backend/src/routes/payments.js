const express = require('express');
const QRCode = require('qrcode');
const auth = require('../middleware/auth');
const { adminAuth, requireRole } = require('../middleware/adminAuth');
const User = require('../models/User');
const ServiceRequest = require('../models/ServiceRequest');
const Coupon = require('../models/Coupon');
const CouponRedemption = require('../models/CouponRedemption');
const CoraPixCharge = require('../models/CoraPixCharge');
const StripeConfig = require('../models/StripeConfig');
const { dispatchToNextProfessional } = require('../utils/requestQueue');
const { resolveCouponsForCheckout } = require('../services/couponService');
const { calculateCheckoutPricing } = require('../services/dynamicCheckoutService');
const {
  hasCoraConfigured,
  createPixInvoice,
  getInvoice,
  createWebhookEndpoint,
} = require('../services/coraService');

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
  const stripe = await getStripe();

  if (user.stripeCustomerId) {
    try {
      const existing = await stripe.customers.retrieve(user.stripeCustomerId);
      if (existing && !existing.deleted) {
        return user.stripeCustomerId;
      }
    } catch (err) {
      const missingCustomer = err?.code === 'resource_missing' && err?.param === 'customer';
      if (!missingCustomer) throw err;
      // Se o customer salvo for de outro ambiente (test/live), cria um novo no ambiente atual.
    }
  }

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

function onlyDigits(value) {
  return String(value || '').replace(/\D/g, '');
}

function toIsoDate(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

function mapCoraInvoiceStatus(status) {
  if (status === 'PAID') return 'paid';
  if (status === 'CANCELLED') return 'cancelled';
  return 'pending';
}

function getWebhookBaseUrl(req) {
  const explicit = process.env.PUBLIC_BASE_URL || process.env.API_PUBLIC_BASE_URL;
  if (explicit) return explicit.replace(/\/$/, '');

  const proto = req.headers['x-forwarded-proto'] || req.protocol;
  const host = req.headers['x-forwarded-host'] || req.get('host');
  return `${proto}://${host}`;
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
  let customFormData = {};
  if (m.customFormData) {
    try {
      customFormData = JSON.parse(m.customFormData);
    } catch {
      customFormData = {};
    }
  }
  const {
    pricePerHour,
    estimated,
    platformFee,
    normalizedCustomFormData,
    customFormSummary,
  } = await calculateCheckoutPricing({
    hours: parseInt(m.hours),
    hasProducts,
    serviceTypeSlug,
    customFormData,
  });
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
      customFormData: normalizedCustomFormData,
      customFormSummary,
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

async function createRequestFromCoraCharge(charge, io) {
  if (charge.serviceRequest) {
    const existingByReference = await ServiceRequest.findById(charge.serviceRequest);
    if (existingByReference) return existingByReference;
  }

  const txId = `cora:${charge.coraInvoiceId}`;
  const existing = await ServiceRequest.findOne({ 'payment.transactionId': txId });
  if (existing) {
    if (!charge.serviceRequest) {
      charge.serviceRequest = existing._id;
      charge.status = 'paid';
      if (!charge.paidAt) charge.paidAt = new Date();
      await charge.save();
    }
    return existing;
  }

  const p = charge.requestPayload || {};
  const address = p.address || {};
  const hasProducts = Boolean(p.hasProducts);
  const serviceTypeSlug = p.serviceTypeSlug || null;
  const {
    pricePerHour,
    estimated,
    platformFee,
    normalizedCustomFormData,
    customFormSummary,
  } = await calculateCheckoutPricing({
    hours: Number(p.hours),
    hasProducts,
    serviceTypeSlug,
    customFormData: p.customFormData || {},
  });

  const discountTotal = Number(charge.discountTotal || 0);
  const finalEstimated = Math.max(0, estimated - discountTotal);
  const appliedCoupons = Array.isArray(charge.appliedCoupons) ? charge.appliedCoupons : [];
  const couponDocs = await Coupon.find({ code: { $in: appliedCoupons.map((c) => c.code) } }).select('_id code');
  const couponByCode = new Map(couponDocs.map((c) => [c.code, c]));

  const request = await ServiceRequest.create({
    client: charge.client,
    serviceTypeSlug,
    details: {
      hours: Number(p.hours || 1),
      rooms: Number(p.rooms || 1),
      bathrooms: Number(p.bathrooms || 1),
      hasProducts,
      customFormData: normalizedCustomFormData,
      customFormSummary,
      notes: p.notes || '',
      scheduledDate: p.scheduledDate,
    },
    address,
    pricing: {
      pricePerHour,
      estimated: finalEstimated,
      discountTotal,
      appliedCoupons: appliedCoupons.map((c) => c.code),
      platformFee,
    },
    payment: {
      status: 'paid',
      method: 'pix',
      transactionId: txId,
      paidAt: charge.paidAt || new Date(),
    },
  });

  if (appliedCoupons.length) {
    const redemptions = appliedCoupons
      .filter((coupon) => couponByCode.has(coupon.code))
      .map((coupon) => ({
        updateOne: {
          filter: { paymentIntentId: txId, coupon: couponByCode.get(coupon.code)._id },
          update: {
            $setOnInsert: {
              coupon: couponByCode.get(coupon.code)._id,
              user: charge.client,
              serviceRequest: request._id,
              paymentIntentId: txId,
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

  charge.serviceRequest = request._id;
  charge.status = 'paid';
  if (!charge.paidAt) charge.paidAt = new Date();
  await charge.save();

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
    customFormData,
    couponCodes,
  } = req.body;
  if (!hours || !address?.street || !address?.city || !scheduledDate) {
    return res.status(400).json({ message: 'Dados do pedido incompletos' });
  }

  try {
    const { estimated, normalizedCustomFormData } = await calculateCheckoutPricing({
      hours,
      hasProducts: !!hasProducts,
      serviceTypeSlug: serviceTypeSlug || null,
      customFormData: customFormData || {},
    });
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
          customFormData: JSON.stringify(normalizedCustomFormData),
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

  const { hours, hasProducts, serviceTypeSlug, customFormData, couponCodes } = req.body;
  if (!hours) return res.status(400).json({ message: 'hours é obrigatório' });

  try {
    const { estimated, pricePerHour, normalizedCustomFormData, pricingBreakdown } = await calculateCheckoutPricing({
      hours,
      hasProducts: !!hasProducts,
      serviceTypeSlug: serviceTypeSlug || null,
      customFormData: customFormData || {},
    });
    const checkout = await resolveCouponsForCheckout({
      couponCodes,
      user: req.user,
      orderSubtotal: estimated,
    });

    res.json({
      subtotal: estimated,
      discountTotal: checkout.pricing.totalDiscount,
      total: checkout.pricing.finalTotal,
      pricePerHour,
      customFormData: normalizedCustomFormData,
      pricingBreakdown,
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

// POST /api/payments/cora/pix/create
// Cria uma cobranca Pix Cora com expiracao local de 15 minutos (sem reutilizacao)
router.post('/cora/pix/create', auth, async (req, res) => {
  if (req.user.userType !== 'client') {
    return res.status(403).json({ message: 'Apenas clientes podem fazer pagamentos' });
  }

  if (!hasCoraConfigured()) {
    return res.status(503).json({ message: 'Cora nao configurada no backend' });
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
    customFormData,
    couponCodes,
  } = req.body;

  if (!hours || !address?.street || !address?.city || !scheduledDate) {
    return res.status(400).json({ message: 'Dados do pedido incompletos' });
  }

  try {
    const user = await User.findById(req.user._id);
    const cpf = onlyDigits(user.cpf);
    if (!cpf || cpf.length !== 11) {
      return res.status(400).json({ message: 'CPF valido e obrigatorio para pagamento via Pix' });
    }

    const { estimated, normalizedCustomFormData } = await calculateCheckoutPricing({
      hours,
      hasProducts: !!hasProducts,
      serviceTypeSlug: serviceTypeSlug || null,
      customFormData: customFormData || {},
    });
    const checkout = await resolveCouponsForCheckout({
      couponCodes,
      user: req.user,
      orderSubtotal: estimated,
    });

    const finalAmount = checkout.pricing.finalTotal;
    const finalAmountCents = Math.round(finalAmount * 100);
    if (finalAmountCents < 500) {
      return res.status(400).json({ message: 'Valor minimo para Pix e de R$ 5,00' });
    }

    const invoice = await createPixInvoice({
      amountCents: finalAmountCents,
      code: `ja-${req.user._id}-${Date.now()}`,
      customer: {
        name: user.name,
        email: user.email,
        document: cpf,
        documentType: 'CPF',
      },
      serviceDescription: `Servico agendado para ${scheduledDate}`,
      dueDate: toIsoDate(new Date()),
    });

    const expiresAt = new Date(Date.now() + (15 * 60 * 1000));
    const charge = await CoraPixCharge.create({
      client: req.user._id,
      coraInvoiceId: invoice.invoiceId,
      coraStatus: invoice.status || 'OPEN',
      status: mapCoraInvoiceStatus(invoice.status),
      amount: finalAmount,
      subtotal: estimated,
      discountTotal: checkout.pricing.totalDiscount,
      appliedCoupons: checkout.pricing.appliedCoupons.map((c) => ({
        code: c.code,
        discountAmount: c.discountAmount,
      })),
      rejectedCoupons: checkout.rejectedCoupons,
      requestPayload: {
        hours,
        hasProducts: !!hasProducts,
        rooms: rooms || 1,
        bathrooms: bathrooms || 1,
        notes: notes || '',
        address,
        scheduledDate,
        serviceTypeSlug: serviceTypeSlug || null,
        customFormData: normalizedCustomFormData,
      },
      qrCodeUrl: invoice.qrCodeUrl,
      emv: invoice.emv,
      expiresAt,
      paidAt: invoice.status === 'PAID' ? new Date() : null,
    });

    if (charge.status === 'paid') {
      const io = req.app.get('io');
      await createRequestFromCoraCharge(charge, io);
    }

    return res.status(201).json({
      charge: {
        id: charge._id,
        status: charge.status,
        amount: charge.amount,
        subtotal: charge.subtotal,
        discountTotal: charge.discountTotal,
        appliedCoupons: charge.appliedCoupons,
        rejectedCoupons: charge.rejectedCoupons,
        qrCodeUrl: charge.qrCodeUrl,
        emv: charge.emv,
        expiresAt: charge.expiresAt,
      },
    });
  } catch (err) {
    console.error('Cora pix create error:', err);
    return res.status(500).json({ message: 'Erro ao criar cobranca Pix Cora' });
  }
});

// GET /api/payments/cora/pix/:chargeId/status
// Consulta status local e sincroniza com Cora quando pendente
router.get('/cora/pix/:chargeId/status', auth, async (req, res) => {
  try {
    const charge = await CoraPixCharge.findById(req.params.chargeId);
    if (!charge) return res.status(404).json({ message: 'Cobranca nao encontrada' });
    if (String(charge.client) !== String(req.user._id)) {
      return res.status(403).json({ message: 'Acesso negado' });
    }

    if (charge.status === 'pending' && new Date() > charge.expiresAt) {
      charge.status = 'expired';
      await charge.save();
    }

    if (charge.status === 'pending' && hasCoraConfigured()) {
      try {
        const invoice = await getInvoice(charge.coraInvoiceId);
        const nextStatus = mapCoraInvoiceStatus(invoice.status);
        charge.coraStatus = invoice.status || charge.coraStatus;

        if (nextStatus === 'paid') {
          charge.status = 'paid';
          charge.paidAt = charge.paidAt || new Date();
          await charge.save();
          const io = req.app.get('io');
          await createRequestFromCoraCharge(charge, io);
        } else if (nextStatus === 'cancelled') {
          charge.status = 'cancelled';
          await charge.save();
        } else {
          await charge.save();
        }
      } catch {
        // Mantem status local se a consulta externa falhar.
      }
    }

    const remainingMs = Math.max(0, new Date(charge.expiresAt).getTime() - Date.now());
    const response = {
      id: charge._id,
      status: charge.status,
      amount: charge.amount,
      subtotal: charge.subtotal,
      discountTotal: charge.discountTotal,
      qrCodeUrl: charge.qrCodeUrl,
      emv: charge.emv,
      expiresAt: charge.expiresAt,
      remainingSeconds: Math.ceil(remainingMs / 1000),
      requestId: charge.serviceRequest || null,
    };

    return res.json(response);
  } catch {
    return res.status(500).json({ message: 'Erro ao consultar cobranca Pix' });
  }
});

// GET /api/payments/cora/pix/:chargeId/qr
// Gera um QR code puro (sem branding Cora) em formato SVG a partir do EMV
router.get('/cora/pix/:chargeId/qr', async (req, res) => {
  try {
    const charge = await CoraPixCharge.findById(req.params.chargeId);
    if (!charge) {
      return res.status(404).json({ message: 'Cobranca nao encontrada' });
    }

    if (!charge.emv) {
      return res.status(400).json({ message: 'Cobranca sem codigo EMV disponivel' });
    }

    // Gera QR code em formato SVG a partir do EMV
    const qrSvg = await QRCode.toString(charge.emv, {
      type: 'image/svg+xml',
      width: 300,
      margin: 1,
      color: {
        dark: '#000000',
        light: '#FFFFFF',
      },
    });

    res.setHeader('Content-Type', 'image/svg+xml');
    res.setHeader('Cache-Control', 'public, max-age=3600');
    return res.send(qrSvg);
  } catch (err) {
    console.error('Erro ao gerar QR code:', err);
    return res.status(500).json({ message: 'Erro ao gerar QR code' });
  }
});

// GET /api/payments/cora/webhook/endpoints
// Retorna URLs para cadastro de webhooks no Cora Web
router.get('/cora/webhook/endpoints', adminAuth, requireRole('super_admin', 'admin'), (req, res) => {
  const base = getWebhookBaseUrl(req);
  return res.json({
    webhookUrl: `${base}/api/payments/cora/webhook`,
    suggestedEvents: [
      { resource: 'invoice', trigger: 'paid' },
      { resource: 'invoice', trigger: '*' },
    ],
  });
});

// POST /api/payments/cora/webhook/register
// Opcional: registra endpoint na Cora automaticamente para invoice.paid
router.post('/cora/webhook/register', adminAuth, requireRole('super_admin', 'admin'), async (req, res) => {

  if (!hasCoraConfigured()) {
    return res.status(503).json({ message: 'Cora nao configurada no backend' });
  }

  try {
    const { url, resource = 'invoice', trigger = 'paid' } = req.body || {};
    const endpointUrl = String(url || '').trim() || `${getWebhookBaseUrl(req)}/api/payments/cora/webhook`;
    const result = await createWebhookEndpoint({ url: endpointUrl, resource, trigger });
    return res.status(201).json({ endpoint: result });
  } catch (err) {
    console.error('Cora webhook register error:', err);
    return res.status(500).json({ message: 'Erro ao registrar endpoint de webhook na Cora' });
  }
});

// POST /api/payments/cora/webhook
// Webhook de eventos da Cora. O evento chega via headers.
router.post('/cora/webhook', async (req, res) => {
  try {
    const eventType = String(req.headers['webhook-event-type'] || '').toLowerCase();
    const resourceId = String(req.headers['webhook-resource-id'] || '').trim();

    if (!resourceId) return res.json({ success: true, ignored: true });

    const charge = await CoraPixCharge.findOne({ coraInvoiceId: resourceId });
    if (!charge) return res.json({ success: true, ignored: true });

    if (eventType === 'invoice.paid' || eventType.endsWith('.paid')) {
      charge.status = 'paid';
      charge.coraStatus = 'PAID';
      charge.paidAt = charge.paidAt || new Date();
      await charge.save();
      const io = req.app.get('io');
      await createRequestFromCoraCharge(charge, io);
    } else if (eventType === 'invoice.canceled' || eventType.endsWith('.canceled')) {
      if (charge.status === 'pending') {
        charge.status = 'cancelled';
        charge.coraStatus = 'CANCELLED';
        await charge.save();
      }
    }

    return res.json({ success: true });
  } catch (err) {
    console.error('Cora webhook error:', err);
    return res.status(500).json({ success: false });
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
