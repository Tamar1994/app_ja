const express = require('express');
const mongoose = require('mongoose');
const auth = require('../middleware/auth');
const Transaction = require('../models/Transaction');
const User = require('../models/User');
const WithdrawalRequest = require('../models/WithdrawalRequest');

const router = express.Router();

const WITHDRAWAL_MIN_AMOUNT = 50;
const WITHDRAWAL_COOLDOWN_DAYS = 7;

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
    const [user, recentTransactions, latestWithdrawal] = await Promise.all([
      User.findById(req.user._id).select('wallet professional cpf userType'),
      Transaction.find({ professional: req.user._id })
        .sort({ createdAt: -1 })
        .limit(10)
        .populate('serviceRequest', 'details.scheduledDate'),
      WithdrawalRequest.findOne({ professional: req.user._id })
        .sort({ requestedAt: -1 })
        .select('requestedAt status amount'),
    ]);

    const nextWithdrawalAt = computeNextWithdrawalAt(latestWithdrawal?.requestedAt);
    const now = new Date();
    const canRequestWithdrawal = user.userType === 'professional'
      && Number(user.wallet?.balance || 0) >= WITHDRAWAL_MIN_AMOUNT
      && (!nextWithdrawalAt || now >= nextWithdrawalAt);

    res.json({
      balance: user.wallet?.balance || 0,
      totalEarned: user.wallet?.totalEarned || 0,
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
  if (req.user.userType !== 'professional') {
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

// POST /api/wallet/withdrawals/request — solicitar saque PIX manual
router.post('/withdrawals/request', auth, async (req, res) => {
  if (req.user.userType !== 'professional') {
    return res.status(403).json({ message: 'Apenas profissionais podem solicitar saque' });
  }

  const amount = Number(req.body?.amount || 0);
  if (!Number.isFinite(amount) || amount < WITHDRAWAL_MIN_AMOUNT) {
    return res.status(400).json({
      message: `Valor mínimo para saque é R$ ${WITHDRAWAL_MIN_AMOUNT.toFixed(2).replace('.', ',')}`,
    });
  }

  const normalizedCpf = normalizeCpf(req.user.cpf);
  if (normalizedCpf.length !== 11) {
    return res.status(400).json({
      message: 'Seu CPF precisa estar válido no cadastro para saque via PIX.',
    });
  }

  try {
    const lastWithdrawal = await WithdrawalRequest.findOne({ professional: req.user._id })
      .sort({ requestedAt: -1 })
      .select('requestedAt');
    const nextAllowedAt = computeNextWithdrawalAt(lastWithdrawal?.requestedAt);
    if (nextAllowedAt && new Date() < nextAllowedAt) {
      return res.status(400).json({
        message: 'Você já solicitou saque nos últimos 7 dias.',
        nextAllowedAt,
      });
    }

    const session = await mongoose.startSession();
    let createdWithdrawal = null;
    let updatedUser = null;

    try {
      await session.withTransaction(async () => {
        updatedUser = await User.findOneAndUpdate(
          {
            _id: req.user._id,
            'wallet.balance': { $gte: amount },
          },
          {
            $inc: { 'wallet.balance': -amount },
          },
          { new: true, session }
        );

        if (!updatedUser) {
          throw new Error('Saldo insuficiente para este saque');
        }

        const [withdrawal] = await WithdrawalRequest.create([{
          professional: req.user._id,
          amount: Number(amount.toFixed(2)),
          pixKeyCpfSnapshot: normalizedCpf,
          status: 'pending',
          requestedAt: new Date(),
        }], { session });

        createdWithdrawal = withdrawal;

        await Transaction.create([{
          professional: req.user._id,
          withdrawalRequest: withdrawal._id,
          type: 'withdrawal',
          grossAmount: Number(amount.toFixed(2)),
          platformFee: 0,
          amount: Number(amount.toFixed(2)),
          status: 'withdrawn',
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

module.exports = router;
