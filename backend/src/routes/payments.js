'use strict';
const express = require('express');
const mongoose = require('mongoose');
const auth = require('../middleware/auth');
const { adminAuth, requireRole } = require('../middleware/adminAuth');
const User = require('../models/User');
const ServiceRequest = require('../models/ServiceRequest');
const Coupon = require('../models/Coupon');
const CouponRedemption = require('../models/CouponRedemption');
const AsaasPayment = require('../models/AsaasPayment');
const WithdrawalRequest = require('../models/WithdrawalRequest');
const ClientWalletTransaction = require('../models/ClientWalletTransaction');
const { dispatchToNextProfessional } = require('../utils/requestQueue');
const { resolveCouponsForCheckout } = require('../services/couponService');
const { calculateCheckoutPricing } = require('../services/dynamicCheckoutService');
const asaas = require('../services/asaasService');
const { logAudit } = require('../utils/auditLog');

const router = express.Router();

// ── Helpers genéricos ─────────────────────────────────────────────────────────

function onlyDigits(value) {
  return String(value || '').replace(/\D/g, '');
}

function normalizeWalletInput(rawUseWallet, rawWalletAmount) {
  const useWallet = Boolean(rawUseWallet);
  const parsed = Number(rawWalletAmount);
  const walletAmount = Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  return { useWallet, walletAmount };
}

function buildWalletUsage({ user, totalPayableAfterCoupons, requestedWalletAmount = null, forceUseWallet = false }) {
  const clientWalletBalance = Number(user?.clientWallet?.balance || 0);
  const professionalWalletBalance = Number(user?.wallet?.balance || 0);
  const maxWalletAvailable = Math.max(0, clientWalletBalance + professionalWalletBalance);

  const requested = requestedWalletAmount === null
    ? (forceUseWallet ? totalPayableAfterCoupons : 0)
    : requestedWalletAmount;

  const targetWalletUse = Math.max(0, Math.min(Number(requested || 0), totalPayableAfterCoupons, maxWalletAvailable));
  const fromClientWallet = Math.min(clientWalletBalance, targetWalletUse);
  const fromProfessionalWallet = Math.min(professionalWalletBalance, targetWalletUse - fromClientWallet);
  const totalWalletUsed = Number((fromClientWallet + fromProfessionalWallet).toFixed(2));

  return {
    fromClientWallet: Number(fromClientWallet.toFixed(2)),
    fromProfessionalWallet: Number(fromProfessionalWallet.toFixed(2)),
    totalWalletUsed,
    maxWalletAvailable: Number(maxWalletAvailable.toFixed(2)),
  };
}

async function applyWalletDebit({ userId, serviceRequestId, walletUsage, transactionLabel = 'Checkout' }) {
  const debitClient = Number(walletUsage?.fromClientWallet || 0);
  const debitProfessional = Number(walletUsage?.fromProfessionalWallet || 0);
  const totalDebit = Number((debitClient + debitProfessional).toFixed(2));
  if (totalDebit <= 0) return;

  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      const user = await User.findById(userId).session(session);
      if (!user) throw new Error('Usuário não encontrado para débito em carteira');

      const availableClient = Number(user.clientWallet?.balance || 0);
      const availableProfessional = Number(user.wallet?.balance || 0);
      if (availableClient + availableProfessional + 0.0001 < totalDebit) {
        throw new Error('Saldo em carteira insuficiente para concluir pagamento');
      }

      const safeDebitClient = Math.min(availableClient, debitClient);
      const safeDebitProfessional = Math.min(availableProfessional, debitProfessional);

      if (safeDebitClient > 0) {
        user.clientWallet.balance = Number((availableClient - safeDebitClient).toFixed(2));
      }
      if (safeDebitProfessional > 0) {
        user.wallet.balance = Number((availableProfessional - safeDebitProfessional).toFixed(2));
      }

      await user.save({ session });

      await ClientWalletTransaction.create([{
        user: user._id,
        serviceRequest: serviceRequestId || null,
        type: 'debit_payment',
        source: safeDebitClient > 0 && safeDebitProfessional > 0
          ? 'mixed'
          : (safeDebitClient > 0 ? 'client_wallet' : 'professional_wallet'),
        amount: totalDebit,
        balanceAfterClientWallet: Number(user.clientWallet?.balance || 0),
        balanceAfterProfessionalWallet: Number(user.wallet?.balance || 0),
        metadata: {
          label: transactionLabel,
          fromClientWallet: Number(safeDebitClient.toFixed(2)),
          fromProfessionalWallet: Number(safeDebitProfessional.toFixed(2)),
        },
      }], { session });
    });
  } finally {
    await session.endSession();
  }
}

// ── Criação do ServiceRequest a partir de pagamento Asaas ─────────────────────

async function createRequestFromAsaasPayment(payment, io) {
  if (payment.serviceRequest) {
    const existing = await ServiceRequest.findById(payment.serviceRequest);
    if (existing) return existing;
  }

  const txId = `asaas:${payment.asaasPaymentId}`;
  const existingByTx = await ServiceRequest.findOne({ 'payment.transactionId': txId });
  if (existingByTx) {
    if (!payment.serviceRequest) {
      payment.serviceRequest = existingByTx._id;
      payment.status = 'paid';
      if (!payment.paidAt) payment.paidAt = new Date();
      await payment.save();
    }
    return existingByTx;
  }

  const p = payment.requestPayload || {};
  const address = p.address || {};
  const serviceTypeSlug = p.serviceTypeSlug || null;
  const tierLabel = p.tierLabel || null;
  const isScheduled = !!p.isScheduled;
  const selectedUpsells = (p.selectedUpsells || [])
    .map((u) => (typeof u === 'string' ? u : u.key))
    .filter(Boolean);

  const {
    tier,
    tierPrice,
    upsellsTotal,
    estimated,
    platformFee,
    platformFeePercent,
    upsells: resolvedUpsells,
  } = await calculateCheckoutPricing({
    serviceTypeSlug,
    tierLabel,
    selectedUpsells,
    scheduledDate: p.scheduledDate,
    city: address?.city || null,
    state: address?.state || null,
  });

  const discountTotal = Number(payment.discountTotal || 0);
  const walletAppliedTotal = Number(payment.walletAppliedTotal || 0);
  const walletAppliedClient = Number(payment.walletAppliedClient || 0);
  const walletAppliedProfessional = Number(payment.walletAppliedProfessional || 0);
  const customerTotalAfterCoupons = Math.max(0, estimated - discountTotal);
  const customerTotalPaid = Math.max(0, customerTotalAfterCoupons - walletAppliedTotal);

  const appliedCoupons = Array.isArray(payment.appliedCoupons) ? payment.appliedCoupons : [];
  const couponDocs = await Coupon.find({ code: { $in: appliedCoupons.map((c) => c.code) } }).select('_id code');
  const couponByCode = new Map(couponDocs.map((c) => [c.code, c]));

  const request = await ServiceRequest.create({
    client: payment.client,
    serviceTypeSlug,
    requestType: isScheduled ? 'scheduled' : 'immediate',
    status: isScheduled ? 'pending_professional' : 'searching',
    details: {
      tierLabel,
      durationMinutes: tier.durationMinutes,
      upsells: resolvedUpsells,
      notes: p.notes || '',
      scheduledDate: p.scheduledDate,
    },
    address,
    pricing: {
      tierPrice,
      upsellsTotal,
      estimated,
      platformFeePercent,
      platformFee,
      final: customerTotalAfterCoupons,
      customerTotal: customerTotalAfterCoupons,
      customerPaidExternal: customerTotalPaid,
      walletAppliedTotal,
      walletAppliedClient,
      walletAppliedProfessional,
      discountTotal,
      appliedCoupons: appliedCoupons.map((c) => c.code),
    },
    payment: {
      status: 'paid',
      method: payment.paymentMethod === 'credit_card' ? 'card' : 'pix',
      transactionId: txId,
      paidAt: payment.paidAt || new Date(),
      walletUsedAmount: walletAppliedTotal,
    },
  });

  if (walletAppliedTotal > 0) {
    await applyWalletDebit({
      userId: payment.client,
      serviceRequestId: request._id,
      walletUsage: { fromClientWallet: walletAppliedClient, fromProfessionalWallet: walletAppliedProfessional },
      transactionLabel: `Pagamento ${payment.paymentMethod === 'pix' ? 'Pix' : 'Cartão'} parcial com carteira`,
    });
  }

  if (appliedCoupons.length) {
    const redemptions = appliedCoupons
      .filter((coupon) => couponByCode.has(coupon.code))
      .map((coupon) => ({
        updateOne: {
          filter: { paymentIntentId: txId, coupon: couponByCode.get(coupon.code)._id },
          update: {
            $setOnInsert: {
              coupon: couponByCode.get(coupon.code)._id,
              user: payment.client,
              serviceRequest: request._id,
              paymentIntentId: txId,
              couponCodeSnapshot: coupon.code,
              discountAmount: coupon.discountAmount,
            },
          },
          upsert: true,
        },
      }));
    if (redemptions.length) await CouponRedemption.bulkWrite(redemptions, { ordered: false });
  }

  payment.serviceRequest = request._id;
  payment.status = 'paid';
  if (!payment.paidAt) payment.paidAt = new Date();
  await payment.save();

  if (io && !isScheduled) dispatchToNextProfessional(request._id, io);
  return request;
}

// ── Obter (ou criar) customerId Asaas para o usuário (lazy) ──────────────────

async function getOrCreateAsaasCustomerId(user) {
  if (user.asaasCustomerId) return user.asaasCustomerId;

  const customerId = await asaas.findOrCreateCustomer({
    name: user.name,
    email: user.email,
    cpf: user.cpf,
    phone: user.phone,
  });

  await User.findByIdAndUpdate(user._id, { asaasCustomerId: customerId });
  user.asaasCustomerId = customerId;
  return customerId;
}

// ── ROTAS ─────────────────────────────────────────────────────────────────────

// GET /api/payments/config
router.get('/config', (req, res) => {
  res.json({ mode: asaas.getMode(), provider: 'asaas', configured: asaas.isConfigured() });
});

// POST /api/payments/preview
router.post('/preview', auth, async (req, res) => {
  if (req.user.userType !== 'client' && req.user.activeProfile !== 'client') {
    return res.status(403).json({ message: 'Apenas clientes podem simular pagamento' });
  }
  const { serviceTypeSlug, tierLabel, selectedUpsells = [], scheduledDate, address, couponCodes, useWallet, walletAmount } = req.body;
  if (!tierLabel) return res.status(400).json({ message: 'tierLabel é obrigatório' });
  try {
    const { estimated } = await calculateCheckoutPricing({
      serviceTypeSlug, tierLabel, selectedUpsells,
      scheduledDate: scheduledDate || null,
      city: address?.city || null,
      state: address?.state || null,
    });
    const checkout = await resolveCouponsForCheckout({ couponCodes, user: req.user, orderSubtotal: estimated });
    const walletInput = normalizeWalletInput(useWallet, walletAmount);
    const walletUsage = buildWalletUsage({ user: req.user, totalPayableAfterCoupons: checkout.pricing.finalTotal, requestedWalletAmount: walletInput.walletAmount, forceUseWallet: walletInput.useWallet });
    return res.json({
      subtotal: estimated,
      discountTotal: checkout.pricing.totalDiscount,
      totalBeforeWallet: checkout.pricing.finalTotal,
      walletApplied: walletUsage.totalWalletUsed,
      walletAppliedClient: walletUsage.fromClientWallet,
      walletAppliedProfessional: walletUsage.fromProfessionalWallet,
      walletAvailable: walletUsage.maxWalletAvailable,
      total: Number((checkout.pricing.finalTotal - walletUsage.totalWalletUsed).toFixed(2)),
      appliedCoupons: checkout.pricing.appliedCoupons,
      rejectedCoupons: checkout.rejectedCoupons,
    });
  } catch { return res.status(500).json({ message: 'Erro ao simular pagamento' }); }
});

// POST /api/payments/pix/create
router.post('/pix/create', auth, async (req, res) => {
  if (req.user.userType !== 'client' && req.user.activeProfile !== 'client') {
    return res.status(403).json({ message: 'Apenas clientes podem fazer pagamentos' });
  }
  if (!asaas.isConfigured()) return res.status(503).json({ message: 'Asaas não configurado' });

  const {
    serviceTypeSlug, tierLabel, selectedUpsells = [], notes, address,
    scheduledDate, couponCodes, useWallet, walletAmount, isScheduled = false,
  } = req.body;

  if (!tierLabel || !address?.street || !address?.city || !scheduledDate) {
    return res.status(400).json({ message: 'Dados do pedido incompletos' });
  }

  try {
    const user = await User.findById(req.user._id);
    const cpf = onlyDigits(user.cpf);
    if (!cpf || cpf.length !== 11) return res.status(400).json({ message: 'CPF válido é obrigatório para pagamento via Pix' });

    const { tier, tierPrice, upsellsTotal, estimated, platformFee, platformFeePercent, upsells: resolvedUpsells } = await calculateCheckoutPricing({ serviceTypeSlug, tierLabel, selectedUpsells, scheduledDate, city: address?.city || null, state: address?.state || null });
    const checkout = await resolveCouponsForCheckout({ couponCodes, user: req.user, orderSubtotal: estimated });
    const walletInput = normalizeWalletInput(useWallet, walletAmount);
    const walletUsage = buildWalletUsage({ user, totalPayableAfterCoupons: checkout.pricing.finalTotal, requestedWalletAmount: walletInput.walletAmount, forceUseWallet: walletInput.useWallet });
    const payableAfterWallet = Number((checkout.pricing.finalTotal - walletUsage.totalWalletUsed).toFixed(2));

    // Pagamento 100% via carteira interna
    if (payableAfterWallet <= 0) {
      const request = await ServiceRequest.create({
        client: req.user._id, serviceTypeSlug: serviceTypeSlug || null,
        requestType: isScheduled ? 'scheduled' : 'immediate', status: isScheduled ? 'pending_professional' : 'searching',
        details: { tierLabel, durationMinutes: tier.durationMinutes, upsells: resolvedUpsells, notes: notes || '', scheduledDate },
        address,
        pricing: { tierPrice, upsellsTotal, estimated, platformFeePercent, platformFee, final: checkout.pricing.finalTotal, customerTotal: checkout.pricing.finalTotal, customerPaidExternal: 0, walletAppliedTotal: walletUsage.totalWalletUsed, walletAppliedClient: walletUsage.fromClientWallet, walletAppliedProfessional: walletUsage.fromProfessionalWallet, discountTotal: checkout.pricing.totalDiscount, appliedCoupons: checkout.pricing.appliedCoupons.map((c) => c.code) },
        payment: { status: 'paid', method: 'wallet', transactionId: `wallet:${req.user._id}:${Date.now()}`, paidAt: new Date(), walletUsedAmount: walletUsage.totalWalletUsed },
      });
      await applyWalletDebit({ userId: req.user._id, serviceRequestId: request._id, walletUsage, transactionLabel: 'Pagamento integral com carteira' });
      const io = req.app.get('io');
      if (io && !isScheduled) dispatchToNextProfessional(request._id, io);
      return res.status(201).json({ walletOnly: true, request });
    }

    if (payableAfterWallet < 5) return res.status(400).json({ message: 'Valor mínimo para Pix é de R$ 5,00 após carteira' });

    const customerId = await getOrCreateAsaasCustomerId(user);

    const asaasResult = await asaas.createPixPayment({
      customerId,
      value: payableAfterWallet,
      description: `Serviço ${tierLabel}`,
      externalReference: `ja-${req.user._id}-${Date.now()}`,
    });

    let pixPayload = null;
    let pixEncodedImage = null;
    let pixExpiresAt = null;

    try {
      const qr = await asaas.getPixQrCode(asaasResult.id);
      pixPayload = qr.payload || null;
      pixEncodedImage = qr.encodedImage || null;
      pixExpiresAt = qr.expirationDate ? new Date(qr.expirationDate) : new Date(Date.now() + 30 * 60 * 1000);
    } catch (qrErr) {
      console.error('[pix/create] Erro ao buscar QR Asaas:', qrErr.message);
      pixExpiresAt = new Date(Date.now() + 30 * 60 * 1000);
    }

    const asaasPayment = await AsaasPayment.create({
      client: req.user._id,
      asaasPaymentId: asaasResult.id,
      asaasCustomerId: customerId,
      paymentMethod: 'pix',
      status: 'pending',
      asaasStatus: asaasResult.status,
      amount: payableAfterWallet,
      subtotal: estimated,
      discountTotal: checkout.pricing.totalDiscount,
      walletAppliedTotal: walletUsage.totalWalletUsed,
      walletAppliedClient: walletUsage.fromClientWallet,
      walletAppliedProfessional: walletUsage.fromProfessionalWallet,
      appliedCoupons: checkout.pricing.appliedCoupons.map((c) => ({ code: c.code, discountAmount: c.discountAmount })),
      rejectedCoupons: checkout.rejectedCoupons,
      requestPayload: { serviceTypeSlug: serviceTypeSlug || null, tierLabel, selectedUpsells: resolvedUpsells, notes: notes || '', address, scheduledDate, isScheduled: !!isScheduled },
      pixPayload,
      pixEncodedImage,
      pixExpiresAt,
    });

    return res.status(201).json({
      charge: {
        id: asaasPayment._id,
        status: asaasPayment.status,
        amount: asaasPayment.amount,
        subtotal: asaasPayment.subtotal,
        discountTotal: asaasPayment.discountTotal,
        walletApplied: asaasPayment.walletAppliedTotal,
        walletAppliedClient: asaasPayment.walletAppliedClient,
        walletAppliedProfessional: asaasPayment.walletAppliedProfessional,
        appliedCoupons: asaasPayment.appliedCoupons,
        rejectedCoupons: asaasPayment.rejectedCoupons,
        emv: pixPayload,
        expiresAt: asaasPayment.pixExpiresAt,
      },
    });
  } catch (err) {
    console.error('[pix/create] error:', err);
    return res.status(500).json({ message: 'Erro ao criar cobrança Pix: ' + err.message });
  }
});

// GET /api/payments/pix/:paymentId/status
router.get('/pix/:paymentId/status', auth, async (req, res) => {
  try {
    const payment = await AsaasPayment.findById(req.params.paymentId);
    if (!payment) return res.status(404).json({ message: 'Pedido não encontrado' });
    if (String(payment.client) !== String(req.user._id)) return res.status(403).json({ message: 'Acesso negado' });

    if (payment.status === 'pending' && payment.pixExpiresAt && new Date() > payment.pixExpiresAt) {
      payment.status = 'expired';
      payment.asaasStatus = 'OVERDUE';
      await payment.save();
    }

    if (payment.status === 'pending' && asaas.isConfigured()) {
      try {
        const remote = await asaas.getPayment(payment.asaasPaymentId);
        const remoteStatus = remote.status || '';

        if (remoteStatus === 'RECEIVED' || remoteStatus === 'CONFIRMED') {
          payment.status = 'paid';
          payment.asaasStatus = remoteStatus;
          payment.paidAt = payment.paidAt || new Date();
          await payment.save();
          const io = req.app.get('io');
          await createRequestFromAsaasPayment(payment, io);
        } else if (remoteStatus === 'OVERDUE' || remoteStatus === 'DELETED') {
          payment.status = 'expired';
          payment.asaasStatus = remoteStatus;
          await payment.save();
        } else {
          payment.asaasStatus = remoteStatus;
          await payment.save();
        }
      } catch (pollErr) {
        console.warn('[pix/status] Erro ao consultar Asaas:', pollErr.message);
      }
    }

    const remainingMs = payment.pixExpiresAt ? Math.max(0, new Date(payment.pixExpiresAt).getTime() - Date.now()) : 0;
    return res.json({
      id: payment._id,
      status: payment.status,
      amount: payment.amount,
      subtotal: payment.subtotal,
      discountTotal: payment.discountTotal,
      walletApplied: payment.walletAppliedTotal,
      walletAppliedClient: payment.walletAppliedClient,
      walletAppliedProfessional: payment.walletAppliedProfessional,
      emv: payment.pixPayload,
      expiresAt: payment.pixExpiresAt,
      remainingSeconds: Math.ceil(remainingMs / 1000),
      requestId: payment.serviceRequest || null,
    });
  } catch (err) {
    console.error('[pix/status] error:', err);
    return res.status(500).json({ message: 'Erro ao consultar pedido Pix' });
  }
});

// GET /api/payments/pix/:paymentId/qr
router.get('/pix/:paymentId/qr', async (req, res) => {
  try {
    const payment = await AsaasPayment.findById(req.params.paymentId).select('pixEncodedImage pixPayload asaasPaymentId');
    if (!payment) return res.status(404).json({ message: 'Pedido não encontrado' });

    let encoded = payment.pixEncodedImage;

    if (!encoded && payment.asaasPaymentId && asaas.isConfigured()) {
      try {
        const qr = await asaas.getPixQrCode(payment.asaasPaymentId);
        encoded = qr.encodedImage || null;
        if (encoded) {
          AsaasPayment.findByIdAndUpdate(payment._id, { pixEncodedImage: encoded, pixPayload: qr.payload || payment.pixPayload }).catch(() => {});
        }
      } catch { /* serve 404 abaixo */ }
    }

    if (!encoded) return res.status(404).json({ message: 'QR code não disponível' });

    const imgBuffer = Buffer.from(encoded, 'base64');
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'public, max-age=300');
    return res.send(imgBuffer);
  } catch (err) {
    console.error('[pix/qr] error:', err);
    return res.status(500).json({ message: 'Erro ao servir QR code' });
  }
});

// GET /api/payments/cards — lista cartões salvos do usuário (sem tokens)
router.get('/cards', auth, async (req, res) => {
  try {
    const user = await User.findById(req.user._id).select('savedCards');
    const cards = (user?.savedCards || []).map((c) => ({
      _id: c._id,
      brand: c.brand,
      lastFour: c.lastFour,
      holderName: c.holderName,
      expiryMonth: c.expiryMonth,
      expiryYear: c.expiryYear,
      isDefault: c.isDefault,
      addedAt: c.addedAt,
    }));
    return res.json({ cards });
  } catch (err) {
    console.error('[cards/list] error:', err);
    return res.status(500).json({ message: 'Erro ao listar cartões' });
  }
});

// DELETE /api/payments/cards/:id — remove cartão salvo
router.delete('/cards/:id', auth, async (req, res) => {
  try {
    const user = await User.findById(req.user._id);
    if (!user) return res.status(404).json({ message: 'Usuário não encontrado' });
    const card = user.savedCards.id(req.params.id);
    if (!card) return res.status(404).json({ message: 'Cartão não encontrado' });
    if (String(card._id) !== req.params.id) return res.status(403).json({ message: 'Acesso negado' });
    user.savedCards.pull(req.params.id);
    await user.save();
    return res.json({ message: 'Cartão removido' });
  } catch (err) {
    console.error('[cards/delete] error:', err);
    return res.status(500).json({ message: 'Erro ao remover cartão' });
  }
});

// POST /api/payments/card/pay
router.post('/card/pay', auth, async (req, res) => {
  if (req.user.userType !== 'client' && req.user.activeProfile !== 'client') {
    return res.status(403).json({ message: 'Apenas clientes podem fazer pagamentos' });
  }
  if (!asaas.isConfigured()) return res.status(503).json({ message: 'Asaas não configurado' });

  const {
    savedCardId,
    saveCard,
    holderName, cardNumber, expiryMonth, expiryYear, ccv,
    serviceTypeSlug, tierLabel, selectedUpsells = [], notes, address,
    scheduledDate, couponCodes, useWallet, walletAmount, isScheduled = false, installments = 1,
  } = req.body;

  // Validar dados de cartão — obrigatório quando não usa cartão salvo
  if (!savedCardId && (!holderName || !cardNumber || !expiryMonth || !expiryYear || !ccv)) {
    return res.status(400).json({ message: 'Dados do cartão são obrigatórios' });
  }
  if (!tierLabel || !address?.street || !address?.city || !scheduledDate) {
    return res.status(400).json({ message: 'Dados do pedido incompletos' });
  }

  try {
    const user = await User.findById(req.user._id);
    const cpf = onlyDigits(user.cpf);
    if (!cpf || cpf.length !== 11) return res.status(400).json({ message: 'CPF válido é obrigatório para pagamento com cartão' });

    const { tier, tierPrice, upsellsTotal, estimated, platformFee, platformFeePercent, upsells: resolvedUpsells } = await calculateCheckoutPricing({ serviceTypeSlug, tierLabel, selectedUpsells, scheduledDate, city: address?.city || null, state: address?.state || null });
    const checkout = await resolveCouponsForCheckout({ couponCodes, user: req.user, orderSubtotal: estimated });
    const walletInput = normalizeWalletInput(useWallet, walletAmount);
    const walletUsage = buildWalletUsage({ user, totalPayableAfterCoupons: checkout.pricing.finalTotal, requestedWalletAmount: walletInput.walletAmount, forceUseWallet: walletInput.useWallet });
    const payableAfterWallet = Number((checkout.pricing.finalTotal - walletUsage.totalWalletUsed).toFixed(2));

    if (payableAfterWallet <= 0) {
      const request = await ServiceRequest.create({
        client: req.user._id, serviceTypeSlug: serviceTypeSlug || null,
        requestType: isScheduled ? 'scheduled' : 'immediate', status: isScheduled ? 'pending_professional' : 'searching',
        details: { tierLabel, durationMinutes: tier.durationMinutes, upsells: resolvedUpsells, notes: notes || '', scheduledDate },
        address,
        pricing: { tierPrice, upsellsTotal, estimated, platformFeePercent, platformFee, final: checkout.pricing.finalTotal, customerTotal: checkout.pricing.finalTotal, customerPaidExternal: 0, walletAppliedTotal: walletUsage.totalWalletUsed, walletAppliedClient: walletUsage.fromClientWallet, walletAppliedProfessional: walletUsage.fromProfessionalWallet, discountTotal: checkout.pricing.totalDiscount, appliedCoupons: checkout.pricing.appliedCoupons.map((c) => c.code) },
        payment: { status: 'paid', method: 'wallet', transactionId: `wallet:${req.user._id}:${Date.now()}`, paidAt: new Date(), walletUsedAmount: walletUsage.totalWalletUsed },
      });
      await applyWalletDebit({ userId: req.user._id, serviceRequestId: request._id, walletUsage, transactionLabel: 'Pagamento integral com carteira' });
      const io = req.app.get('io');
      if (io && !isScheduled) dispatchToNextProfessional(request._id, io);
      return res.status(201).json({ walletOnly: true, request });
    }

    const customerId = await getOrCreateAsaasCustomerId(user);
    const remoteIp = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '127.0.0.1').split(',')[0].trim();

    let asaasResult;
    try {
      if (savedCardId) {
        // ── Pagamento com cartão salvo ────────────────────────────────────
        const savedCard = user.savedCards.id(savedCardId);
        if (!savedCard) return res.status(404).json({ message: 'Cartão salvo não encontrado' });
        asaasResult = await asaas.createCreditCardPaymentWithToken({
          customerId,
          value: payableAfterWallet,
          description: `Serviço ${tierLabel}`,
          externalReference: `ja-card-${req.user._id}-${Date.now()}`,
          creditCardToken: savedCard.token,
          installments: Number(installments) || 1,
        });
      } else {
        // ── Pagamento com dados de cartão brutos ──────────────────────────
        asaasResult = await asaas.createCreditCardPayment({
          customerId,
          value: payableAfterWallet,
          description: `Serviço ${tierLabel}`,
          externalReference: `ja-card-${req.user._id}-${Date.now()}`,
          holderName,
          cardNumber,
          expiryMonth,
          expiryYear,
          ccv,
          cpf,
          email: user.email,
          phone: user.phone,
          postalCode: address?.zipCode || '00000000',
          addressNumber: address?.number || 'S/N',
          installments: Number(installments) || 1,
          remoteIp,
        });

        // Salvar cartão se solicitado e Asaas retornou token
        if (saveCard && asaasResult?.creditCard?.creditCardToken) {
          const token = asaasResult.creditCard.creditCardToken;
          const alreadySaved = user.savedCards.some((c) => c.token === token);
          if (!alreadySaved) {
            const isFirst = user.savedCards.length === 0;
            user.savedCards.push({
              token,
              brand: (asaasResult.creditCard.creditCardBrand || 'unknown').toLowerCase(),
              lastFour: asaasResult.creditCard.creditCardNumber || '????',
              holderName: holderName || '',
              expiryMonth: String(expiryMonth).padStart(2, '0'),
              expiryYear: String(expiryYear).length === 2 ? '20' + expiryYear : String(expiryYear),
              isDefault: isFirst,
            });
            await user.save();
          }
        }
      }
    } catch (cardErr) {
      const cardMsg = (cardErr.asaasResponse?.errors?.[0]?.description) || cardErr.message || 'Cartão recusado';
      return res.status(402).json({ message: cardMsg });
    }

    const isPaid = asaasResult.status === 'CONFIRMED' || asaasResult.status === 'RECEIVED';

    const asaasPayment = await AsaasPayment.create({
      client: req.user._id,
      asaasPaymentId: asaasResult.id,
      asaasCustomerId: customerId,
      paymentMethod: 'credit_card',
      status: isPaid ? 'paid' : 'failed',
      asaasStatus: asaasResult.status,
      amount: payableAfterWallet,
      subtotal: estimated,
      discountTotal: checkout.pricing.totalDiscount,
      walletAppliedTotal: walletUsage.totalWalletUsed,
      walletAppliedClient: walletUsage.fromClientWallet,
      walletAppliedProfessional: walletUsage.fromProfessionalWallet,
      appliedCoupons: checkout.pricing.appliedCoupons.map((c) => ({ code: c.code, discountAmount: c.discountAmount })),
      rejectedCoupons: checkout.rejectedCoupons,
      requestPayload: { serviceTypeSlug: serviceTypeSlug || null, tierLabel, selectedUpsells: resolvedUpsells, notes: notes || '', address, scheduledDate, isScheduled: !!isScheduled },
      installments: Number(installments) || 1,
      paidAt: isPaid ? new Date() : null,
    });

    if (!isPaid) {
      return res.status(402).json({ message: 'Cartão recusado pela operadora', status: asaasResult.status });
    }

    const io = req.app.get('io');
    const request = await createRequestFromAsaasPayment(asaasPayment, io);
    if (!request) return res.status(400).json({ message: 'Erro ao processar pedido após pagamento' });
    return res.status(201).json({ request });
  } catch (err) {
    console.error('[card/pay] error:', err);
    return res.status(500).json({ message: 'Erro ao processar pagamento: ' + err.message });
  }
});

// POST /api/payments/webhook
router.post('/webhook', async (req, res) => {
  if (!asaas.verifyWebhookToken(req)) {
    console.warn('[webhook] Token inválido');
    return res.status(401).json({ message: 'Token inválido' });
  }

  let event;
  try {
    event = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
  } catch (err) {
    console.error('[webhook] Body inválido:', err.message);
    return res.status(400).json({ message: 'Body inválido' });
  }

  const eventType = event.event || '';
  const paymentData = event.payment || {};

  console.info(`[webhook] Evento: ${eventType} — ${paymentData.id || '?'}`);

  try {
    if ((eventType === 'PAYMENT_RECEIVED' || eventType === 'PAYMENT_CONFIRMED') && paymentData.id) {
      const doc = await AsaasPayment.findOne({ asaasPaymentId: paymentData.id });
      if (!doc) return res.json({ received: true, ignored: true });

      if (doc.status !== 'paid') {
        doc.status = 'paid';
        doc.asaasStatus = paymentData.status || eventType;
        doc.paidAt = doc.paidAt || new Date();
        await doc.save();
        const io = req.app.get('io');
        await createRequestFromAsaasPayment(doc, io);
        console.log(`[webhook] ${eventType} processado — ${paymentData.id}`);
      }
    } else if ((eventType === 'PAYMENT_OVERDUE' || eventType === 'PAYMENT_DELETED') && paymentData.id) {
      const doc = await AsaasPayment.findOne({ asaasPaymentId: paymentData.id });
      if (doc && doc.status === 'pending') {
        doc.status = 'expired';
        doc.asaasStatus = paymentData.status || eventType;
        await doc.save();
      }
    }
  } catch (err) {
    console.error('[webhook] Erro ao processar evento:', err.message);
  }

  return res.json({ received: true });
});

// GET /api/payments/webhook/info (admin)
router.get('/webhook/info', adminAuth, requireRole('super_admin', 'admin'), (req, res) => {
  const proto = req.headers['x-forwarded-proto'] || req.protocol;
  const host = req.headers['x-forwarded-host'] || req.get('host');
  const base = process.env.PUBLIC_BASE_URL || `${proto}://${host}`;
  return res.json({
    webhookUrl: `${base}/api/payments/webhook`,
    transferValidateUrl: `${base}/api/payments/transfer-validate`,
    events: ['PAYMENT_RECEIVED', 'PAYMENT_CONFIRMED', 'PAYMENT_OVERDUE', 'PAYMENT_DELETED'],
    note: 'Configure no painel Asaas → Integrações → Webhooks. Defina o token em ASAAS_WEBHOOK_TOKEN no Render.',
    transferNote: 'Validação de saque: Asaas → Integrações → Mecanismos de segurança → Validação de saque via Webhook. Defina ASAAS_TRANSFER_WEBHOOK_TOKEN no Render.',
    authHeader: 'asaas-access-token',
  });
});

// POST /api/payments/transfer-validate
// Webhook especial do Asaas para validação de saque (Mecanismos de segurança).
// O Asaas envia POST 5s após criar a transferência e aguarda { status: "APPROVED" | "REFUSED" }.
// Configurado em: Asaas → Integrações → Mecanismos de segurança → Validação de saque via Webhook
router.post('/transfer-validate', async (req, res) => {
  // 1. Autenticação: validar token no header asaas-access-token
  if (!asaas.verifyTransferWebhookToken(req)) {
    console.warn('[transfer-validate] Token inválido — requisição recusada');
    return res.status(200).json({ status: 'REFUSED', refuseReason: 'Token de autenticação inválido' });
  }

  let event;
  try {
    event = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
  } catch {
    console.error('[transfer-validate] Body inválido');
    return res.status(200).json({ status: 'REFUSED', refuseReason: 'Payload inválido' });
  }

  const eventType = event?.type || '';
  console.info(`[transfer-validate] Evento recebido: ${eventType}`);

  // 2. Tratar apenas transferências (TRANSFER). Outros tipos (BILL, PIX_QR_CODE, etc.) aprovamos
  //    somente se forem estornos Pix habilitados — por ora aprovamos tudo que não for TRANSFER.
  if (eventType !== 'TRANSFER') {
    console.info(`[transfer-validate] Tipo ${eventType} não é TRANSFER — aprovando automaticamente`);
    return res.status(200).json({ status: 'APPROVED' });
  }

  const transfer = event?.transfer || {};
  const asaasTransferId = transfer?.id || null;
  const transferValue = Number(transfer?.value || 0);

  if (!asaasTransferId) {
    console.warn('[transfer-validate] ID da transferência ausente no payload');
    return res.status(200).json({ status: 'REFUSED', refuseReason: 'ID da transferência ausente no payload' });
  }

  try {
    // 3. Buscar o saque correspondente em nossa base pelo asaasTransferId
    const withdrawal = await WithdrawalRequest.findOne({ asaasTransferId }).lean();

    if (!withdrawal) {
      // Transferência não reconhecida em nossa base — recusar
      console.warn(`[transfer-validate] Transferência ${asaasTransferId} não encontrada na base de dados`);
      await logAudit({
        module: 'wallet',
        action: 'transfer_validate_refused',
        severity: 'high',
        actorType: 'system',
        message: `Transferência Asaas ${asaasTransferId} recusada: não encontrada na base`,
        metadata: { asaasTransferId, transferValue },
      });
      return res.status(200).json({ status: 'REFUSED', refuseReason: 'Transferência não encontrada em nossa base de dados' });
    }

    // 4. Validar que o valor bate (tolerância de R$ 0,02 para arredondamentos)
    const expectedValue = Number(withdrawal.amount);
    if (Math.abs(transferValue - expectedValue) > 0.02) {
      console.warn(`[transfer-validate] Valor divergente: esperado R$ ${expectedValue}, recebido R$ ${transferValue}`);
      await WithdrawalRequest.findByIdAndUpdate(withdrawal._id, {
        asaasTransferStatus: 'REFUSED',
        internalNote: `Valor divergente: esperado R$ ${expectedValue}, Asaas enviou R$ ${transferValue}`,
        status: 'cancelled',
      });
      await logAudit({
        module: 'wallet',
        action: 'transfer_validate_refused',
        severity: 'critical',
        actorType: 'system',
        message: `Transferência ${asaasTransferId} recusada: valor divergente`,
        metadata: { asaasTransferId, expectedValue, transferValue },
      });
      return res.status(200).json({ status: 'REFUSED', refuseReason: `Valor divergente: esperado R$ ${expectedValue.toFixed(2)}, recebido R$ ${transferValue.toFixed(2)}` });
    }

    // 5. Tudo ok — aprovar e marcar como completed
    await WithdrawalRequest.findByIdAndUpdate(withdrawal._id, {
      asaasTransferStatus: 'APPROVED',
      status: 'completed',
      processedAt: new Date(),
      completedAt: new Date(),
      internalNote: `Aprovado via webhook de validação. Asaas transfer id: ${asaasTransferId}`,
    });

    console.info(`[transfer-validate] Transferência ${asaasTransferId} aprovada — R$ ${transferValue}`);
    await logAudit({
      module: 'wallet',
      action: 'transfer_validate_approved',
      severity: 'info',
      actorType: 'system',
      message: `Saque ${asaasTransferId} aprovado via webhook. R$ ${transferValue}`,
      metadata: { asaasTransferId, transferValue, withdrawalId: withdrawal._id },
    });

    return res.status(200).json({ status: 'APPROVED' });
  } catch (err) {
    console.error('[transfer-validate] Erro ao processar validação:', err.message);
    // Em caso de erro interno, recusamos para não deixar saque não validado passar
    return res.status(200).json({ status: 'REFUSED', refuseReason: 'Erro interno ao validar transferência' });
  }
});

module.exports = router;