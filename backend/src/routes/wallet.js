const express = require('express');
const auth = require('../middleware/auth');
const Transaction = require('../models/Transaction');
const User = require('../models/User');

const router = express.Router();

// GET /api/wallet/summary — saldo e total ganho
router.get('/summary', auth, async (req, res) => {
  try {
    const user = await User.findById(req.user._id).select('wallet professional');
    const recentTransactions = await Transaction.find({ professional: req.user._id })
      .sort({ createdAt: -1 })
      .limit(10)
      .populate('serviceRequest', 'details.scheduledDate');

    res.json({
      balance: user.wallet?.balance || 0,
      totalEarned: user.wallet?.totalEarned || 0,
      totalServices: user.professional?.totalServicesCompleted || 0,
      transactions: recentTransactions,
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

module.exports = router;
