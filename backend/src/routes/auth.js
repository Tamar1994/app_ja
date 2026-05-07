const express = require('express');
const { body, validationResult } = require('express-validator');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const User = require('../models/User');
const { sendVerificationEmail } = require('../services/emailService');

const router = express.Router();

const generateToken = (id) =>
  jwt.sign({ id }, process.env.JWT_SECRET, { expiresIn: process.env.JWT_EXPIRES_IN });

const generateCode = () =>
  String(crypto.randomInt(100000, 999999));

// POST /api/auth/register
router.post('/register', [
  body('name').trim().notEmpty().withMessage('Nome é obrigatório'),
  body('email').isEmail().withMessage('E-mail inválido').normalizeEmail(),
  body('phone').trim().notEmpty().withMessage('Telefone é obrigatório'),
  body('password').isLength({ min: 6 }).withMessage('Senha deve ter pelo menos 6 caracteres'),
  body('userType').isIn(['client', 'professional']).withMessage('Tipo de usuário inválido'),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  const { name, email, phone, password, userType, pricePerHour, bio, cpf, birthDate, serviceTypeSlug } = req.body;

  try {
    const existing = await User.findOne({ email });
    if (existing && existing.isEmailVerified) {
      return res.status(400).json({ message: 'E-mail já cadastrado' });
    }

    const code = generateCode();
    const expires = new Date(Date.now() + 15 * 60 * 1000); // 15 min

    let user;
    if (existing && !existing.isEmailVerified) {
      // Reenviar código para cadastro incompleto
      existing.emailVerificationCode = code;
      existing.emailVerificationExpires = expires;
      if (cpf) existing.cpf = cpf.replace(/[^\d]/g, '');
      if (birthDate) existing.birthDate = new Date(birthDate);
      if (serviceTypeSlug) existing.serviceTypeSlug = serviceTypeSlug;
      await existing.save();
      user = existing;
    } else {
      const userData = {
        name, email, phone, password, userType,
        emailVerificationCode: code,
        emailVerificationExpires: expires,
      };
      if (cpf) userData.cpf = cpf.replace(/[^\d]/g, '');
      if (birthDate) userData.birthDate = new Date(birthDate);
      if (serviceTypeSlug) userData.serviceTypeSlug = serviceTypeSlug;
      if (userType === 'professional') {
        userData.professional = {
          pricePerHour: pricePerHour || 35,
          bio: bio || '',
          isAvailable: false,
        };
      }
      user = await User.create(userData);
    }

    await sendVerificationEmail(email, name, code);

    res.status(201).json({
      message: 'Código de verificação enviado para seu e-mail.',
      email,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Erro ao cadastrar usuário' });
  }
});

// POST /api/auth/verify-email
router.post('/verify-email', [
  body('email').isEmail().normalizeEmail(),
  body('code').isLength({ min: 6, max: 6 }).withMessage('Código inválido'),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  const { email, code } = req.body;
  try {
    const user = await User.findOne({ email })
      .select('+emailVerificationCode +emailVerificationExpires');

    if (!user) {
      return res.status(404).json({ message: 'Usuário não encontrado' });
    }
    if (user.isEmailVerified) {
      return res.status(400).json({ message: 'E-mail já verificado' });
    }
    if (!user.emailVerificationCode || user.emailVerificationCode !== code) {
      return res.status(400).json({ message: 'Código incorreto' });
    }
    if (user.emailVerificationExpires < new Date()) {
      return res.status(400).json({ message: 'Código expirado. Solicite um novo.' });
    }

    user.isEmailVerified = true;
    user.emailVerificationCode = undefined;
    user.emailVerificationExpires = undefined;
    await user.save();

    const token = generateToken(user._id);
    res.json({
      token,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        userType: user.userType,
        isEmailVerified: true,
        verificationStatus: user.verificationStatus,
        professional: user.professional,
      },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Erro ao verificar e-mail' });
  }
});

// POST /api/auth/resend-verification
router.post('/resend-verification', [
  body('email').isEmail().normalizeEmail(),
], async (req, res) => {
  const { email } = req.body;
  try {
    const user = await User.findOne({ email })
      .select('+emailVerificationCode +emailVerificationExpires');

    if (!user || user.isEmailVerified) {
      return res.status(400).json({ message: 'Operação inválida' });
    }

    const code = generateCode();
    user.emailVerificationCode = code;
    user.emailVerificationExpires = new Date(Date.now() + 15 * 60 * 1000);
    await user.save();

    await sendVerificationEmail(email, user.name, code);
    res.json({ message: 'Novo código enviado' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Erro ao reenviar código' });
  }
});

// POST /api/auth/login
router.post('/login', [
  body('email').isEmail().normalizeEmail(),
  body('password').notEmpty(),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  const { email, password } = req.body;
  try {
    const user = await User.findOne({ email }).select('+password');
    if (!user || !(await user.comparePassword(password))) {
      return res.status(401).json({ message: 'E-mail ou senha incorretos' });
    }
    if (!user.isEmailVerified) {
      return res.status(403).json({ message: 'Verifique seu e-mail antes de entrar.', needsVerification: true, email });
    }

    const token = generateToken(user._id);
    res.json({
      token,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        userType: user.userType,
        avatar: user.avatar,
        isEmailVerified: user.isEmailVerified,
        verificationStatus: user.verificationStatus,
        professional: user.professional,
      },
    });
  } catch {
    res.status(500).json({ message: 'Erro ao fazer login' });
  }
});

module.exports = router;

