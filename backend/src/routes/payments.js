'use strict';
const express = require('express');
const mongoose = require('mongoose');
const QRCode = require('qrcode');
const auth = require('../middleware/auth');
const { adminAuth, requireRole } = require('../middleware/adminAuth');
const User = require('../models/User');
const ServiceRequest = require('../models/ServiceRequest');
const Coupon = require('../models/Coupon');
const CouponRedemption = require('../models/CouponRedemption');
const PagarmeOrder = require('../models/PagarmeOrder');
const ClientWalletTransaction = require('../models/ClientWalletTransaction');
const { dispatchToNextProfessional } = require('../utils/requestQueue');
const { resolveCouponsForCheckout } = require('../services/couponService');
const { calculateCheckoutPricing } = require('../services/dynamicCheckoutService');
const pagarme = require('../services/pagarmeService');

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

// ── Criação do ServiceRequest (idempotente) ───────────────────────────────────

async function createRequestFromPagarmeOrder(order, io) {
  if (order.serviceRequest) {
    const existing = await ServiceRequest.findById(order.serviceRequest);
    if (existing) return existing;
  }

  const txId = `pagarme:${order.pagarmeOrderId}`;
  const existingByTx = await ServiceRequest.findOne({ 'payment.transactionId': txId });
  if (existingByTx) {
    if (!order.serviceRequest) {
      order.serviceRequest = existingByTx._id;
      order.status = 'paid';
      if (!order.paidAt) order.paidAt = new Date();
      await order.save();
    }
    return existingByTx;
  }

  const p = order.requestPayload || {};
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

  const discountTotal = Number(order.discountTotal || 0);
  const walletAppliedTotal = Number(order.walletAppliedTotal || 0);
  const walletAppliedClient = Number(order.walletAppliedClient || 0);
  const walletAppliedProfessional = Number(order.walletAppliedProfessional || 0);
  const customerTotalAfterCoupons = Math.max(0, estimated - discountTotal);
  const customerTotalPaid = Math.max(0, customerTotalAfterCoupons - walletAppliedTotal);

  const appliedCoupons = Array.isArray(order.appliedCoupons) ? order.appliedCoupons : [];
  const couponDocs = await Coupon.find({ code: { $in: appliedCoupons.map((c) => c.code) } }).select('_id code');
  const couponByCode = new Map(couponDocs.map((c) => [c.code, c]));

  const request = await ServiceRequest.create({
    client: order.client,
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
      method: order.paymentMethod === 'credit_card' ? 'card' : 'pix',
      transactionId: txId,
      paidAt: order.paidAt || new Date(),
      walletUsedAmount: walletAppliedTotal,
    },
  });

  if (walletAppliedTotal > 0) {
    await applyWalletDebit({
      userId: order.client,
      serviceRequestId: request._id,
      walletUsage: { fromClientWallet: walletAppliedClient, fromProfessionalWallet: walletAppliedProfessional },
      transactionLabel: `Pagamento ${order.paymentMethod === 'pix' ? 'Pix' : 'Cartão'} parcial com carteira`,
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
              user: order.client,
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

  order.serviceRequest = request._id;
  order.status = 'paid';
  if (!order.paidAt) order.paidAt = new Date();
  await order.save();

  if (io && !isScheduled) dispatchToNextProfessional(request._id, io);
  return request;
}

function buildPagarmeCustomer(user) {
  const phoneDigits = onlyDigits(user.phone);
  const ddd = phoneDigits.slice(0, 2);
  const number = phoneDigits.slice(2);
  return {
    name: user.name,
    email: user.email,
    document: onlyDigits(user.cpf) || undefined,
    document_type: 'CPF',
    type: 'individual',
    ...(ddd && number ? { phones: { home_phone: { country_code: '55', area_code: ddd, number } } } : {}),
  };
}

// ── ROTAS ─────────────────────────────────────────────────────────────────────

// GET /api/payments/config
router.get('/config', (req, res) => {
  res.json({ mode: pagarme.getMode(), publicKey: pagarme.getPublicKey() || null });
});

// POST /api/payments/preview
router.post('/preview', auth, async (req, res) => {
  if (req.user.userType !== 'client' && req.user.activeProfile !== 'client') {
    return res.status(403).json({ message: 'Apenas clientes podem simular pagamento' });
  }
  const { serviceTypeSlug, tierLabel, selectedUpsells = [], scheduledDate, couponCodes, useWallet, walletAmount } = req.body;
  if (!tierLabel) return res.status(400).json({ message: 'tierLabel é obrigatório' });
  try {
    const { estimated } = await calculateCheckoutPricing({ serviceTypeSlug, tierLabel, selectedUpsells, scheduledDate: scheduledDate || null });
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
  if (!pagarme.isConfigured()) return res.status(503).json({ message: 'Pagar.me não configurado' });

  const { serviceTypeSlug, tierLabel, selectedUpsells = [], notes, address, scheduledDate, couponCodes, useWallet, walletAmount, isScheduled = false } = req.body;
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

    const amountCents = Math.round(payableAfterWallet * 100);
    const splitRules = pagarme.buildSplitRules({ amountCents, platformFeePercent, professionalRecipientId: null });
    const orderCode = `ja-${req.user._id}-${Date.now()}`;

    const pagarmeResult = await pagarme.createPixOrder({
      code: orderCode, amountCents, customer: buildPagarmeCustomer(user),
      description: `Serviço ${tierLabel} - ${scheduledDate}`, expiresIn: 900, splitRules,
    });

    const charge = pagarmeResult.charges?.[0];
    const lastTx = charge?.last_transaction || {};
    const pixEmv = lastTx.qr_code || null;
    const pixQrCodeUrl = lastTx.qr_code_url || null;
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000);

    const pagarmeOrder = await PagarmeOrder.create({
      client: req.user._id, pagarmeOrderId: pagarmeResult.id, pagarmeChargeId: charge?.id || null,
      paymentMethod: 'pix', status: 'pending', amount: payableAfterWallet, amountCents,
      subtotal: estimated, discountTotal: checkout.pricing.totalDiscount,
      walletAppliedTotal: walletUsage.totalWalletUsed, walletAppliedClient: walletUsage.fromClientWallet, walletAppliedProfessional: walletUsage.fromProfessionalWallet,
      appliedCoupons: checkout.pricing.appliedCoupons.map((c) => ({ code: c.code, discountAmount: c.discountAmount })),
      rejectedCoupons: checkout.rejectedCoupons,
      requestPayload: { serviceTypeSlug: serviceTypeSlug || null, tierLabel, selectedUpsells: resolvedUpsells, notes: notes || '', address, scheduledDate, isScheduled: !!isScheduled },
      pixEmv, pixQrCodeUrl, pixExpiresAt: expiresAt,
      platformRecipientId: pagarme.getPlatformRecipientId() || null, professionalRecipientId: null, splitApplied: splitRules.length > 0,
    });

    return res.status(201).json({
      charge: {
        id: pagarmeOrder._id, status: pagarmeOrder.status, amount: pagarmeOrder.amount,
        subtotal: pagarmeOrder.subtotal, discountTotal: pagarmeOrder.discountTotal,
        walletApplied: pagarmeOrder.walletAppliedTotal, walletAppliedClient: pagarmeOrder.walletAppliedClient, walletAppliedProfessional: pagarmeOrder.walletAppliedProfessional,
        appliedCoupons: pagarmeOrder.appliedCoupons, rejectedCoupons: pagarmeOrder.rejectedCoupons,
        emv: pixEmv, qrCodeUrl: pixQrCodeUrl, expiresAt: pagarmeOrder.pixExpiresAt,
      },
    });
  } catch (err) {
    console.error('[pix/create] error:', err);
    return res.status(500).json({ message: 'Erro ao criar cobrança Pix: ' + err.message });
  }
});

// GET /api/payments/pix/:orderId/status
router.get('/pix/:orderId/status', auth, async (req, res) => {
  try {
    const pagarmeOrder = await PagarmeOrder.findById(req.params.orderId);
    if (!pagarmeOrder) return res.status(404).json({ message: 'Pedido não encontrado' });
    if (String(pagarmeOrder.client) !== String(req.user._id)) return res.status(403).json({ message: 'Acesso negado' });

    if (pagarmeOrder.status === 'pending' && pagarmeOrder.pixExpiresAt && new Date() > pagarmeOrder.pixExpiresAt) {
      pagarmeOrder.status = 'expired';
      await pagarmeOrder.save();
    }

    if (pagarmeOrder.status === 'pending' && pagarme.isConfigured()) {
      try {
        const remoteOrder = await pagarme.getOrder(pagarmeOrder.pagarmeOrderId);
        if (remoteOrder.status === 'paid') {
          pagarmeOrder.status = 'paid';
          pagarmeOrder.paidAt = pagarmeOrder.paidAt || new Date();
          if (remoteOrder.charges?.[0]?.id && !pagarmeOrder.pagarmeChargeId) pagarmeOrder.pagarmeChargeId = remoteOrder.charges[0].id;
          await pagarmeOrder.save();
          const io = req.app.get('io');
          await createRequestFromPagarmeOrder(pagarmeOrder, io);
        } else if (remoteOrder.status === 'canceled') {
          pagarmeOrder.status = 'cancelled';
          await pagarmeOrder.save();
        }
      } catch { /* mantém status local */ }
    }

    const remainingMs = pagarmeOrder.pixExpiresAt ? Math.max(0, new Date(pagarmeOrder.pixExpiresAt).getTime() - Date.now()) : 0;
    return res.json({
      id: pagarmeOrder._id, status: pagarmeOrder.status, amount: pagarmeOrder.amount,
      subtotal: pagarmeOrder.subtotal, discountTotal: pagarmeOrder.discountTotal,
      walletApplied: pagarmeOrder.walletAppliedTotal, walletAppliedClient: pagarmeOrder.walletAppliedClient, walletAppliedProfessional: pagarmeOrder.walletAppliedProfessional,
      emv: pagarmeOrder.pixEmv, qrCodeUrl: pagarmeOrder.pixQrCodeUrl, expiresAt: pagarmeOrder.pixExpiresAt,
      remainingSeconds: Math.ceil(remainingMs / 1000), requestId: pagarmeOrder.serviceRequest || null,
    });
  } catch { return res.status(500).json({ message: 'Erro ao consultar pedido Pix' }); }
});

// GET /api/payments/pix/:orderId/qr
router.get('/pix/:orderId/qr', async (req, res) => {
  try {
    const pagarmeOrder = await PagarmeOrder.findById(req.params.orderId).select('pixEmv');
    if (!pagarmeOrder) return res.status(404).json({ message: 'Pedido não encontrado' });
    if (!pagarmeOrder.pixEmv) return res.status(400).json({ message: 'QR code não disponível' });
    const qrPng = await QRCode.toBuffer(pagarmeOrder.pixEmv, { type: 'png', width: 300, margin: 1, color: { dark: '#000000', light: '#FFFFFF' } });
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'public, max-age=3600');
    return res.send(qrPng);
  } catch (err) {
    console.error('[pix/qr] error:', err);
    return res.status(500).json({ message: 'Erro ao gerar QR code' });
  }
});

// POST /api/payments/card/pay
// O mobile tokeniza o cartão direto no Pagar.me e envia o token aqui
router.post('/card/pay', auth, async (req, res) => {
  if (req.user.userType !== 'client' && req.user.activeProfile !== 'client') {
    return res.status(403).json({ message: 'Apenas clientes podem fazer pagamentos' });
  }
  if (!pagarme.isConfigured()) return res.status(503).json({ message: 'Pagar.me não configurado' });

  const { cardToken, serviceTypeSlug, tierLabel, selectedUpsells = [], notes, address, scheduledDate, couponCodes, useWallet, walletAmount, isScheduled = false, installments = 1 } = req.body;
  if (!cardToken) return res.status(400).json({ message: 'cardToken é obrigatório' });
  if (!tierLabel || !address?.street || !address?.city || !scheduledDate) return res.status(400).json({ message: 'Dados do pedido incompletos' });

  try {
    const user = await User.findById(req.user._id);
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

    const amountCents = Math.round(payableAfterWallet * 100);
    const splitRules = pagarme.buildSplitRules({ amountCents, platformFeePercent, professionalRecipientId: null });
    const orderCode = `ja-card-${req.user._id}-${Date.now()}`;

    const pagarmeResult = await pagarme.createCardOrder({
      code: orderCode, amountCents, customer: buildPagarmeCustomer(user),
      cardToken, installments: Number(installments) || 1, splitRules,
    });

    const charge = pagarmeResult.charges?.[0];
    const orderStatus = pagarmeResult.status || 'pending';

    const pagarmeOrder = await PagarmeOrder.create({
      client: req.user._id, pagarmeOrderId: pagarmeResult.id, pagarmeChargeId: charge?.id || null,
      paymentMethod: 'credit_card', status: orderStatus === 'paid' ? 'paid' : 'failed',
      amount: payableAfterWallet, amountCents, subtotal: estimated,
      discountTotal: checkout.pricing.totalDiscount, walletAppliedTotal: walletUsage.totalWalletUsed, walletAppliedClient: walletUsage.fromClientWallet, walletAppliedProfessional: walletUsage.fromProfessionalWallet,
      appliedCoupons: checkout.pricing.appliedCoupons.map((c) => ({ code: c.code, discountAmount: c.discountAmount })),
      rejectedCoupons: checkout.rejectedCoupons,
      requestPayload: { serviceTypeSlug: serviceTypeSlug || null, tierLabel, selectedUpsells: resolvedUpsells, notes: notes || '', address, scheduledDate, isScheduled: !!isScheduled },
      platformRecipientId: pagarme.getPlatformRecipientId() || null, professionalRecipientId: null, splitApplied: splitRules.length > 0,
      paidAt: orderStatus === 'paid' ? new Date() : null,
    });

    if (orderStatus !== 'paid') {
      const errMsg = charge?.last_transaction?.gateway_response?.message || 'Cartão recusado';
      return res.status(402).json({ message: errMsg, status: orderStatus });
    }

    const io = req.app.get('io');
    const request = await createRequestFromPagarmeOrder(pagarmeOrder, io);
    if (!request) return res.status(400).json({ message: 'Erro ao processar pedido após pagamento' });
    return res.status(201).json({ request });
  } catch (err) {
    console.error('[card/pay] error:', err);
    const msg = err.pagarmeResponse?.errors?.[0]?.message || err.pagarmeResponse?.message || err.message;
    return res.status(500).json({ message: 'Erro ao processar pagamento: ' + msg });
  }
});

// POST /api/payments/webhook
// Webhook Pagar.me — express.raw() aplicado em app.js ANTES do express.json()
router.post('/webhook', async (req, res) => {
  const authHeader = req.headers['authorization'] || '';

  if (!pagarme.verifyWebhookAuth(authHeader)) {
    console.warn('[webhook] Autenticação inválida');
    return res.status(401).json({ message: 'Autenticação inválida' });
  }

  let event;
  try {
    event = JSON.parse(Buffer.isBuffer(req.body) ? req.body.toString('utf8') : req.body);
  } catch (err) {
    console.error('[webhook] Body inválido:', err.message);
    return res.status(400).json({ message: 'Body inválido' });
  }

  const eventType = event.type || '';
  const data = event.data || {};

  try {
    if (eventType === 'order.paid' || eventType === 'charge.paid') {
      const pagarmeOrderId = data.order_id || data.id;
      const pagarmeOrder = await PagarmeOrder.findOne({ pagarmeOrderId });
      if (!pagarmeOrder) {
        return res.json({ received: true, ignored: true });
      }
      if (pagarmeOrder.status !== 'paid') {
        pagarmeOrder.status = 'paid';
        pagarmeOrder.paidAt = pagarmeOrder.paidAt || new Date();
        if (data.charges?.[0]?.id && !pagarmeOrder.pagarmeChargeId) pagarmeOrder.pagarmeChargeId = data.charges[0].id;
        await pagarmeOrder.save();
        const io = req.app.get('io');
        await createRequestFromPagarmeOrder(pagarmeOrder, io);
        console.log(`[webhook] ${eventType} processado — order ${pagarmeOrderId}`);
      }
    } else if (eventType === 'order.canceled' || eventType === 'order.payment_failed') {
      const pagarmeOrderId = data.id;
      const pagarmeOrder = await PagarmeOrder.findOne({ pagarmeOrderId });
      if (pagarmeOrder && pagarmeOrder.status === 'pending') {
        pagarmeOrder.status = eventType === 'order.canceled' ? 'cancelled' : 'failed';
        await pagarmeOrder.save();
      }
    }
  } catch (err) {
    console.error('[webhook] Erro ao processar evento:', err.message);
  }

  return res.json({ received: true });
});

// POST /api/payments/recipients
// Cria recebedor Pagar.me para o profissional autenticado
router.post('/recipients', auth, async (req, res) => {
  if (req.user.userType !== 'professional' && req.user.activeProfile !== 'professional') {
    return res.status(403).json({ message: 'Apenas profissionais podem cadastrar dados bancários' });
  }
  if (!pagarme.isConfigured()) return res.status(503).json({ message: 'Pagar.me não configurado' });

  const { bank, branchNumber, branchCheckDigit, accountNumber, accountCheckDigit, accountType, holderName } = req.body;
  if (!bank || !branchNumber || !accountNumber || !accountCheckDigit) {
    return res.status(400).json({ message: 'Dados bancários incompletos' });
  }

  try {
    const user = await User.findById(req.user._id);
    const doc = onlyDigits(user.cpf);
    if (!doc || doc.length !== 11) return res.status(400).json({ message: 'CPF válido é obrigatório para cadastrar conta bancária' });

    const recipient = await pagarme.createRecipient({
      name: user.name, email: user.email, document: doc,
      holderName: holderName || user.name, bank, branchNumber,
      branchCheckDigit: branchCheckDigit || '0', accountNumber, accountCheckDigit,
      accountType: accountType || 'checking', phone: user.phone,
    });

    user.pagarmeRecipientId = recipient.id;
    user.bankAccount = { holderName: holderName || user.name, bank, branchNumber, branchCheckDigit: branchCheckDigit || '0', accountNumber, accountCheckDigit, accountType: accountType || 'checking' };
    await user.save();

    return res.status(201).json({ recipientId: recipient.id, message: 'Conta bancária cadastrada com sucesso' });
  } catch (err) {
    console.error('[recipients] error:', err);
    const msg = err.pagarmeResponse?.errors?.[0]?.message || err.message;
    return res.status(500).json({ message: 'Erro ao cadastrar conta bancária: ' + msg });
  }
});

// GET /api/payments/recipients/me
router.get('/recipients/me', auth, async (req, res) => {
  try {
    const user = await User.findById(req.user._id).select('pagarmeRecipientId bankAccount name email cpf phone');
    if (!user) return res.status(404).json({ message: 'Usuário não encontrado' });

    // Lazy auto-create: se tem dados bancários mas ainda não foi criado no Pagar.me
    if (!user.pagarmeRecipientId && user.bankAccount?.accountNumber && pagarme.isConfigured()) {
      try {
        const doc = onlyDigits(user.cpf);
        if (doc && doc.length === 11) {
          const ba = user.bankAccount;
          const recipient = await pagarme.createRecipient({
            name: user.name, email: user.email, document: doc,
            holderName: ba.holderName || user.name, bank: ba.bank,
            branchNumber: ba.branchNumber, branchCheckDigit: ba.branchCheckDigit || '0',
            accountNumber: ba.accountNumber, accountCheckDigit: ba.accountCheckDigit,
            accountType: ba.accountType || 'checking', phone: user.phone,
          });
          user.pagarmeRecipientId = recipient.id;
          await user.save();
          console.log(`[recipients/me] Recebedor auto-criado: ${recipient.id} para ${user._id}`);
        }
      } catch (autoErr) {
        console.error('[recipients/me] Erro ao auto-criar recebedor:', autoErr.message);
      }
    }

    return res.json({
      hasRecipient: Boolean(user.pagarmeRecipientId),
      recipientId: user.pagarmeRecipientId || null,
      bankAccount: user.bankAccount || null,
    });
  } catch { return res.status(500).json({ message: 'Erro ao buscar dados bancários' }); }
});

// PATCH /api/payments/recipients — atualiza dados bancários e recria recebedor no Pagar.me
router.patch('/recipients', auth, async (req, res) => {
  if (req.user.userType !== 'professional' && req.user.activeProfile !== 'professional') {
    return res.status(403).json({ message: 'Apenas profissionais podem atualizar dados bancários' });
  }
  if (!pagarme.isConfigured()) return res.status(503).json({ message: 'Pagar.me não configurado' });

  const { bank, branchNumber, branchCheckDigit, accountNumber, accountCheckDigit, accountType, holderName } = req.body;
  if (!bank || !branchNumber || !accountNumber || !accountCheckDigit) {
    return res.status(400).json({ message: 'Dados bancários incompletos' });
  }

  try {
    const user = await User.findById(req.user._id);
    const doc = onlyDigits(user.cpf);
    if (!doc || doc.length !== 11) return res.status(400).json({ message: 'CPF válido é obrigatório' });

    // Cria novo recebedor no Pagar.me (cada mudança de conta gera um novo rcp_)
    const recipient = await pagarme.createRecipient({
      name: user.name, email: user.email, document: doc,
      holderName: holderName || user.name, bank, branchNumber,
      branchCheckDigit: branchCheckDigit || '0', accountNumber, accountCheckDigit,
      accountType: accountType || 'checking', phone: user.phone,
    });

    user.pagarmeRecipientId = recipient.id;
    user.bankAccount = { holderName: holderName || user.name, bank, branchNumber, branchCheckDigit: branchCheckDigit || '0', accountNumber, accountCheckDigit, accountType: accountType || 'checking' };
    await user.save();

    return res.json({ recipientId: recipient.id, message: 'Conta bancária atualizada com sucesso' });
  } catch (err) {
    console.error('[recipients/patch] error:', err);
    const msg = err.pagarmeResponse?.errors?.[0]?.message || err.message;
    return res.status(500).json({ message: 'Erro ao atualizar conta bancária: ' + msg });
  }
});

// GET /api/payments/webhook/info
router.get('/webhook/info', adminAuth, requireRole('super_admin', 'admin'), (req, res) => {
  const proto = req.headers['x-forwarded-proto'] || req.protocol;
  const host = req.headers['x-forwarded-host'] || req.get('host');
  const base = process.env.PUBLIC_BASE_URL || `${proto}://${host}`;
  return res.json({
    webhookUrl: `${base}/api/payments/webhook`,
    events: ['order.paid', 'order.canceled', 'order.payment_failed', 'charge.paid'],
    note: 'Configure no painel Pagar.me → Configurações → Webhooks. Defina a senha do webhook em PAGARME_WEBHOOK_SECRET no Render.',
  });
});

module.exports = router;
