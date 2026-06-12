const express = require('express');
const mongoose = require('mongoose');
const auth = require('../middleware/auth');
const Transaction = require('../models/Transaction');
const User = require('../models/User');
const WithdrawalRequest = require('../models/WithdrawalRequest');
const ClientWalletTransaction = require('../models/ClientWalletTransaction');
const asaas = require('../services/asaasService');
const logger = require('../utils/logger');

const router = express.Router();

const WITHDRAWAL_MIN_AMOUNT = 30;
const WITHDRAWAL_COOLDOWN_DAYS = 1;

const isProfessionalProfile = (user) => user?.activeProfile === 'professional' || user?.userType === 'professional';

const normalizeCpf = (value) => String(value || '').replace(/\D+/g, '');

const computeNextWithdrawalAt = (lastRequestedAt) => {
  if (!lastRequestedAt) return null;
  const next = new Date(lastRequestedAt);
  next.setDate(next.getDate() + WITHDRAWAL_COOLDOWN_DAYS);
  return next;
};

// GET /api/wallet/summary — saldo e total ganho
router.get('/summary', auth, async (req, res) => {
  try {
    const now = new Date();

    const [user, recentTransactions, latestWithdrawal, balanceAgg] = await Promise.all([
      User.findById(req.user._id).select('wallet professional cpf userType activeProfile'),
      Transaction.find({ professional: req.user._id })
        .sort({ createdAt: -1 })
        .limit(10)
        .populate('serviceRequest', 'details.scheduledDate'),
      WithdrawalRequest.findOne({ professional: req.user._id, status: 'completed' })
        .sort({ requestedAt: -1 })
        .select('requestedAt status amount'),
      // Agrega ganhos liberados vs bloqueados de uma só vez
      Transaction.aggregate([
        { $match: { professional: req.user._id, type: 'earning' } },
        {
          $group: {
            _id: null,
            totalEarned: { $sum: '$amount' },
            availableEarned: {
                $sum: {
                  $cond: [
                    {
                      // null = transação legada (antes da migração) → considera disponível
                      $or: [
                        { $eq: ['$availableAt', null] },
                        { $lte: ['$availableAt', now] },
                      ],
                    },
                    '$amount',
                    0,
                  ],
                },
              },
          },
        },
      ]),
    ]);

    const totalEarned = user.wallet?.totalEarned || 0;
    const currentBalance = user.wallet?.balance || 0;
    const totalWithdrawn = Math.max(0, totalEarned - currentBalance);

    // Saldo disponível = ganhos liberados − já sacados (mínimo 0)
    const availableEarned = balanceAgg[0]?.availableEarned || 0;
    const availableBalance = Math.max(0, Number((availableEarned - totalWithdrawn).toFixed(2)));
    // Saldo bloqueado = ganhos ainda em clearing (cartão de crédito, aguardando 31 dias)
    const pendingBalance = Number(Math.max(0, currentBalance - availableBalance).toFixed(2));

    const nextWithdrawalAt = computeNextWithdrawalAt(latestWithdrawal?.requestedAt);
    const canRequestWithdrawal = isProfessionalProfile(user)
      && availableBalance >= WITHDRAWAL_MIN_AMOUNT
      && (!nextWithdrawalAt || now >= nextWithdrawalAt);

    res.json({
      balance: currentBalance,
      availableBalance, // saldo disponível para saque (PIX liberado + cartões já compensados)
      pendingBalance,   // saldo bloqueado (cartão em clearing — libera em até 31 dias)
      totalEarned,
      totalServices: user.professional?.totalServicesCompleted || 0,
      transactions: recentTransactions,
      pixCpf: user.cpf || null,
      withdrawalRules: {
        minAmount: WITHDRAWAL_MIN_AMOUNT,
        cooldownDays: WITHDRAWAL_COOLDOWN_DAYS,
      },
      canRequestWithdrawal,
      nextWithdrawalAt,
      latestWithdrawal: latestWithdrawal || null,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Erro ao buscar carteira' });
  }
});

// GET /api/wallet/client-summary — saldo e histórico da carteira de créditos do cliente
router.get('/client-summary', auth, async (req, res) => {
  const uid = req.user._id.toString();
  logger.info('[wallet] client-summary: iniciando', { uid });
  try {
    const [user, transactions] = await Promise.all([
      User.findById(req.user._id).select('clientWallet'),
      ClientWalletTransaction.find({ user: req.user._id })
        .sort({ createdAt: -1 })
        .limit(50),
    ]);

    logger.info('[wallet] client-summary: resultado', {
      uid,
      balance: user?.clientWallet?.balance ?? 0,
      txCount: transactions.length,
      firstTxId: transactions[0]?._id?.toString(),
      firstTxUser: transactions[0]?.user?.toString(),
    });

    // Desativa cache HTTP (ETag/304) — dados financeiros sempre devem ser frescos
    res.set('Cache-Control', 'no-store');
    res.json({
      balance: user?.clientWallet?.balance || 0,
      totalRefunded: user?.clientWallet?.totalRefunded || 0,
      transactions,
    });
  } catch (err) {
    logger.error('[wallet] client-summary: erro', { uid, err: err.message, stack: err.stack });
    res.status(500).json({ message: 'Erro ao buscar carteira' });
  }
});

// GET /api/wallet/earnings?period=day|week|month|year
// Retorna ganhos agrupados por período
router.get('/earnings', auth, async (req, res) => {
  const { period = 'week' } = req.query;

  const now = new Date();
  let startDate;
  let groupFormat;

  if (period === 'day') {
    startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate()); // hoje 00:00
    groupFormat = '%H'; // por hora
  } else if (period === 'week') {
    const day = now.getDay(); // 0=dom
    startDate = new Date(now);
    startDate.setDate(now.getDate() - day);
    startDate.setHours(0, 0, 0, 0);
    groupFormat = '%u'; // dia da semana 1-7
  } else if (period === 'month') {
    startDate = new Date(now.getFullYear(), now.getMonth(), 1);
    groupFormat = '%d'; // dia do mês
  } else { // year
    startDate = new Date(now.getFullYear(), 0, 1);
    groupFormat = '%m'; // mês
  }

  try {
    const [grouped, totals] = await Promise.all([
      Transaction.aggregate([
        {
          $match: {
            professional: req.user._id,
            type: 'earning',
            createdAt: { $gte: startDate },
          },
        },
        {
          $group: {
            _id: { $dateToString: { format: groupFormat, date: '$createdAt' } },
            total: { $sum: '$amount' },
            count: { $sum: 1 },
          },
        },
        { $sort: { _id: 1 } },
      ]),
      Transaction.aggregate([
        {
          $match: {
            professional: req.user._id,
            type: 'earning',
            createdAt: { $gte: startDate },
          },
        },
        {
          $group: {
            _id: null,
            total: { $sum: '$amount' },
            count: { $sum: 1 },
            avg: { $avg: '$amount' },
          },
        },
      ]),
    ]);

    const periodTotal = totals[0] || { total: 0, count: 0, avg: 0 };

    res.json({
      period,
      startDate,
      grouped,
      total: periodTotal.total,
      count: periodTotal.count,
      avg: periodTotal.avg,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Erro ao buscar ganhos' });
  }
});

// GET /api/wallet/withdrawals/my — histórico do profissional (sem comprovante interno)
router.get('/withdrawals/my', auth, async (req, res) => {
  if (!isProfessionalProfile(req.user)) {
    return res.status(403).json({ message: 'Apenas profissionais possuem saque' });
  }

  try {
    const withdrawals = await WithdrawalRequest.find({ professional: req.user._id })
      .sort({ requestedAt: -1 })
      .limit(30)
      .select('amount status requestedAt processedAt completedAt pixKeyCpfSnapshot internalNote');

    res.json({
      withdrawals: withdrawals.map((w) => ({
        _id: w._id,
        amount: w.amount,
        status: w.status,
        requestedAt: w.requestedAt,
        processedAt: w.processedAt,
        completedAt: w.completedAt,
        pixKeyCpfSnapshot: w.pixKeyCpfSnapshot,
      })),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Erro ao buscar histórico de saques' });
  }
});

// POST /api/wallet/withdrawals/request — solicitar saque PIX via Pagar.me
router.post('/withdrawals/request', auth, async (req, res) => {
  if (!isProfessionalProfile(req.user)) {
    return res.status(403).json({ message: 'Apenas profissionais podem solicitar saque' });
  }

  const amount = Number(req.body?.amount || 0);
  if (!Number.isFinite(amount) || amount < WITHDRAWAL_MIN_AMOUNT) {
    return res.status(400).json({
      message: `Valor mínimo para saque é R$ ${WITHDRAWAL_MIN_AMOUNT.toFixed(2).replace('.', ',')}`,
    });
  }

  try {
    // Verificar cooldown de 7 dias (apenas saques concluídos contam — cancelados não bloqueiam)
    const lastWithdrawal = await WithdrawalRequest.findOne({ professional: req.user._id, status: 'completed' })
      .sort({ requestedAt: -1 })
      .select('requestedAt');
    const nextAllowedAt = computeNextWithdrawalAt(lastWithdrawal?.requestedAt);
    if (nextAllowedAt && new Date() < nextAllowedAt) {
      return res.status(400).json({
        message: 'Você já realizou um saque hoje. Tente novamente amanhã.',
        nextAllowedAt,
      });
    }

    // Calcular saldo disponível (ganhos liberados − já sacados)
    const now = new Date();
    const user = await User.findById(req.user._id).select('wallet cpf');
    const [balanceAgg] = await Transaction.aggregate([
      { $match: { professional: req.user._id, type: 'earning' } },
      {
        $group: {
          _id: null,
          availableEarned: {
            $sum: {
              $cond: [
                {
                  // null = transação legada (antes da migração) → considera disponível
                  $or: [
                    { $eq: ['$availableAt', null] },
                    { $lte: ['$availableAt', now] },
                  ],
                },
                '$amount',
                0,
              ],
            },
          },
        },
      },
    ]);

    const totalWithdrawn = Math.max(0, (user.wallet?.totalEarned || 0) - (user.wallet?.balance || 0));
    const availableBalance = Math.max(0, Number(((balanceAgg?.availableEarned || 0) - totalWithdrawn).toFixed(2)));

    if (amount > availableBalance) {
      return res.status(400).json({
        message: `Saldo disponível insuficiente. Disponível: R$ ${availableBalance.toFixed(2).replace('.', ',')}. Parte do saldo ainda está em processamento (cartão de crédito libera em até 31 dias).`,
        availableBalance,
      });
    }

    if ((user.wallet?.balance || 0) < amount) {
      return res.status(400).json({ message: 'Saldo insuficiente para este saque' });
    }

    // ── Fluxo Asaas: transferência PIX direta ao CPF do profissional ──────────
    if (asaas.isConfigured()) {
      const normalizedCpf = normalizeCpf(user.cpf || '');
      if (normalizedCpf.length !== 11) {
        return res.status(400).json({ message: 'CPF válido é obrigatório para saque via Pix' });
      }

      // ORDEM: debitar MongoDB PRIMEIRO, depois Asaas. Rollback se Asaas falhar.
      const session = await mongoose.startSession();
      let createdWithdrawal, updatedUser;
      try {
        await session.withTransaction(async () => {
          updatedUser = await User.findOneAndUpdate(
            { _id: req.user._id, 'wallet.balance': { $gte: amount } },
            { $inc: { 'wallet.balance': -amount } },
            { new: true, session }
          );
          if (!updatedUser) throw new Error('Saldo insuficiente — tente novamente');

          [createdWithdrawal] = await WithdrawalRequest.create([{
            professional: req.user._id,
            amount: Number(amount.toFixed(2)),
            pixKeyCpfSnapshot: normalizedCpf,
            status: 'processing',
            requestedAt: new Date(),
            internalNote: 'Aguardando confirmação Asaas',
          }], { session });

          await Transaction.create([{
            professional: req.user._id,
            withdrawalRequest: createdWithdrawal._id,
            type: 'withdrawal',
            grossAmount: Number(amount.toFixed(2)),
            platformFee: 0,
            amount: Number(amount.toFixed(2)),
            status: 'withdrawn',
            availableAt: new Date(),
            description: 'Saque via Asaas PIX',
          }], { session });
        });
      } finally {
        await session.endSession();
      }

      // Chamar Asaas — se falhar, reverter MongoDB
      let transfer;
      try {
        transfer = await asaas.transferToPixKey(normalizedCpf, amount, `Saque profissional ${req.user._id}`);
      } catch (transferErr) {
        console.error('[withdrawal] Erro Asaas transferToPixKey:', transferErr.message);
        await Promise.allSettled([
          User.findByIdAndUpdate(req.user._id, { $inc: { 'wallet.balance': amount } }),
          WithdrawalRequest.findByIdAndUpdate(createdWithdrawal._id, {
            status: 'cancelled',
            internalNote: `Falha Asaas: ${transferErr.message}`,
          }),
          Transaction.deleteOne({ withdrawalRequest: createdWithdrawal._id }),
        ]);
        return res.status(502).json({
          message: 'Não foi possível processar o saque agora. Tente novamente em instantes.',
        });
      }

      await WithdrawalRequest.findByIdAndUpdate(createdWithdrawal._id, {
        status: 'processing',
        asaasTransferId: transfer?.id || null,
        asaasTransferStatus: 'PENDING',
        internalNote: `Asaas transfer id: ${transfer?.id || 'n/a'} — aguardando validação via webhook`,
      });

      return res.status(201).json({
        message: 'Saque solicitado! O valor será depositado na sua chave PIX (CPF) após validação (geralmente em instantes).',
        withdrawal: { ...createdWithdrawal.toObject(), status: 'processing' },
        walletBalance: updatedUser.wallet?.balance || 0,
        availableBalance: Math.max(0, availableBalance - amount),
        nextAllowedAt: computeNextWithdrawalAt(createdWithdrawal.requestedAt),
      });
    }

    // ── Fluxo legado: fila manual (sem Asaas configurado) ────────────────────
    const normalizedCpf = normalizeCpf(user.cpf || '');
    if (normalizedCpf.length !== 11) {
      return res.status(400).json({
        message: 'Seu CPF precisa estar válido no cadastro para saque via PIX.',
      });
    }

    const session = await mongoose.startSession();
    let createdWithdrawal = null;
    let updatedUser = null;
    try {
      await session.withTransaction(async () => {
        updatedUser = await User.findOneAndUpdate(
          { _id: req.user._id, 'wallet.balance': { $gte: amount } },
          { $inc: { 'wallet.balance': -amount } },
          { new: true, session }
        );
        if (!updatedUser) throw new Error('Saldo insuficiente para este saque');

        [createdWithdrawal] = await WithdrawalRequest.create([{
          professional: req.user._id,
          amount: Number(amount.toFixed(2)),
          pixKeyCpfSnapshot: normalizedCpf,
          status: 'pending',
          requestedAt: new Date(),
        }], { session });

        await Transaction.create([{
          professional: req.user._id,
          withdrawalRequest: createdWithdrawal._id,
          type: 'withdrawal',
          grossAmount: Number(amount.toFixed(2)),
          platformFee: 0,
          amount: Number(amount.toFixed(2)),
          status: 'withdrawn',
          availableAt: new Date(),
          description: 'Solicitação de saque PIX (processamento manual)',
        }], { session });
      });
    } finally {
      await session.endSession();
    }

    res.status(201).json({
      message: 'Solicitação de saque registrada. O processamento ocorre em até 24 horas.',
      withdrawal: createdWithdrawal,
      walletBalance: updatedUser.wallet?.balance || 0,
      nextAllowedAt: computeNextWithdrawalAt(createdWithdrawal?.requestedAt),
    });
  } catch (err) {
    console.error(err);
    res.status(400).json({ message: err.message || 'Erro ao solicitar saque' });
  }
});

// POST /api/wallet/transfer-to-client — transfere saldo da carteira profissional para a carteira cliente
// Apenas usuários com perfil profissional ativo + que também têm perfil cliente habilitado
router.post('/transfer-to-client', auth, async (req, res) => {
  if (!isProfessionalProfile(req.user)) {
    return res.status(403).json({ message: 'Apenas profissionais podem transferir para a carteira cliente' });
  }

  const amount = Number(req.body?.amount || 0);
  if (!Number.isFinite(amount) || amount <= 0) {
    return res.status(400).json({ message: 'Valor inválido' });
  }

  const session = await mongoose.startSession();
  try {
    let updatedUser;
    await session.withTransaction(async () => {
      updatedUser = await User.findOneAndUpdate(
        { _id: req.user._id, 'wallet.balance': { $gte: amount } },
        {
          $inc: {
            'wallet.balance': -amount,
            'clientWallet.balance': amount,
            'clientWallet.totalRefunded': amount,
          },
        },
        { new: true, session }
      );

      if (!updatedUser) throw new Error('Saldo insuficiente na carteira profissional');

      await ClientWalletTransaction.create([{
        user: req.user._id,
        type: 'credit_refund',
        source: 'professional_wallet',
        amount,
        balanceAfterClientWallet: updatedUser.clientWallet?.balance || 0,
        metadata: { label: 'Transferência da carteira profissional' },
      }], { session });
    });

    res.json({
      message: 'Transferência realizada com sucesso',
      professionalWalletBalance: updatedUser.wallet?.balance || 0,
      clientWalletBalance: updatedUser.clientWallet?.balance || 0,
    });
  } catch (err) {
    res.status(400).json({ message: err.message || 'Erro ao transferir' });
  } finally {
    await session.endSession();
  }
});

module.exports = router;
