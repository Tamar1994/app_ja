'use strict';
const https = require('https');
const crypto = require('crypto');

const PAGARME_HOST = 'api.pagar.me';
const API_PATH = '/core/v5';

// ── Configuração ──────────────────────────────────────────────────────────────

function getMode() {
  return process.env.PAGARME_MODE || 'test';
}

function getSecretKey() {
  const mode = getMode();
  const raw = mode === 'production'
    ? process.env.PAGARME_API_KEY_PROD
    : process.env.PAGARME_API_KEY_TEST;
  return raw ? raw.trim() : raw; // trim evita erro por whitespace acidental no env var
}

function getPublicKey() {
  const mode = getMode();
  return mode === 'production'
    ? process.env.PAGARME_PUBLIC_KEY_PROD
    : process.env.PAGARME_PUBLIC_KEY_TEST;
}

function getPlatformRecipientId() {
  const mode = getMode();
  return mode === 'production'
    ? process.env.PAGARME_PLATFORM_RECIPIENT_ID_PROD
    : process.env.PAGARME_PLATFORM_RECIPIENT_ID_TEST;
}

function isConfigured() {
  return Boolean(getSecretKey());
}

function makeAuthHeader() {
  const key = getSecretKey();
  if (!key) throw new Error('PAGARME_API_KEY não configurada para o modo ' + getMode());
  // Pagar.me v5: chave secreta começa com sk_test_ ou sk_live_
  if (!key.startsWith('sk_')) {
    console.warn(
      `[pagarme] AVISO: A chave configurada não começa com "sk_" — verifique se está usando a chave SECRETA (não a pública pk_). Modo: ${getMode()}`,
    );
  }
  // Basic auth: base64(api_key:)  — o dois-pontos após a chave é obrigatório
  return 'Basic ' + Buffer.from(key + ':').toString('base64');
}

// ── Cliente HTTP ──────────────────────────────────────────────────────────────

function apiRequest(method, path, body) {
  return new Promise((resolve, reject) => {
    const bodyStr = body ? JSON.stringify(body) : null;

    // Log resumido da requisição (sem dados sensíveis completos)
    console.info(`[pagarme] → ${method} ${API_PATH + path}`, bodyStr ? bodyStr.slice(0, 300) : '(sem body)');
    const options = {
      hostname: PAGARME_HOST,
      port: 443,
      path: API_PATH + path,
      method,
      headers: {
        Authorization: makeAuthHeader(),
        'Content-Type': 'application/json',
        Accept: 'application/json',
        ...(bodyStr ? { 'Content-Length': Buffer.byteLength(bodyStr, 'utf8') } : {}),
      },
    };

    const req = https.request(options, (res) => {
      let raw = '';
      res.on('data', (chunk) => { raw += chunk; });
      res.on('end', () => {
        let parsed;
        try { parsed = JSON.parse(raw); } catch { parsed = { raw }; }
        if (res.statusCode >= 400) {
          // Loga o corpo completo para facilitar diagnóstico
          console.error(
            `[pagarme] HTTP ${res.statusCode} ${method} ${API_PATH + path} → corpo: ${raw.slice(0, 500)}`,
          );
          const err = new Error(
            parsed?.message
              || `Pagar.me ${res.statusCode}: ${JSON.stringify(parsed).slice(0, 200)}`,
          );
          err.statusCode = res.statusCode;
          err.pagarmeResponse = parsed;
          return reject(err);
        }
        resolve(parsed);
      });
    });

    req.on('error', reject);
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

// ── Verificação de webhook ────────────────────────────────────────────────────

/**
 * Verifica autenticação do webhook Pagar.me via HTTP Basic Auth.
 * Pagar.me envia: Authorization: Basic base64(user:password)
 * Variáveis de ambiente: PAGARME_WEBHOOK_USER e PAGARME_WEBHOOK_PASSWORD
 * Se nenhuma das duas estiver configurada, aceita (modo dev).
 */
function verifyWebhookAuth(authHeader) {
  const expectedUser = process.env.PAGARME_WEBHOOK_USER || '';
  const expectedPass = process.env.PAGARME_WEBHOOK_PASSWORD || '';

  if (!expectedUser && !expectedPass) {
    console.warn('[pagarme] PAGARME_WEBHOOK_USER/PASSWORD não configurados — autenticação ignorada');
    return true;
  }

  if (!authHeader || !authHeader.startsWith('Basic ')) return false;

  try {
    const decoded = Buffer.from(authHeader.slice(6), 'base64').toString('utf8');
    const colonIdx = decoded.indexOf(':');
    if (colonIdx === -1) return false;
    const user = decoded.slice(0, colonIdx);
    const pass = decoded.slice(colonIdx + 1);

    // Comparação segura contra timing attacks
    const uBuf = Buffer.alloc(Math.max(user.length, expectedUser.length));
    const pBuf = Buffer.alloc(Math.max(pass.length, expectedPass.length));
    uBuf.write(user); const euBuf = Buffer.alloc(uBuf.length); euBuf.write(expectedUser);
    pBuf.write(pass); const epBuf = Buffer.alloc(pBuf.length); epBuf.write(expectedPass);

    const userOk = user.length === expectedUser.length && crypto.timingSafeEqual(uBuf, euBuf);
    const passOk = pass.length === expectedPass.length && crypto.timingSafeEqual(pBuf, epBuf);
    return userOk && passOk;
  } catch {
    return false;
  }
}

// Mantido por compatibilidade (não usado pelo Pagar.me v5)
function verifyWebhookSignature() { return true; }

// ── Split ─────────────────────────────────────────────────────────────────────

/**
 * Monta o array de split rules para um pedido.
 * - platformFeePercent: percentual da plataforma (ex: 15 para 15%)
 * - professionalRecipientId: se null, 100% fica na plataforma
 * Retorna [] se a plataforma não tiver recipient configurado.
 */
function buildSplitRules({ amountCents, platformFeePercent, professionalRecipientId }) {
  const platformId = getPlatformRecipientId();
  if (!platformId) {
    console.info('[pagarme] PAGARME_PLATFORM_RECIPIENT_ID não configurado — pedido criado SEM split (100% fica na plataforma)');
    return [];
  }

  const platformAmount = Math.round(amountCents * platformFeePercent / 100);
  const professionalAmount = amountCents - platformAmount;

  console.info(
    `[pagarme] split: plataforma=${platformId} R$${(platformAmount / 100).toFixed(2)}` +
    (professionalRecipientId ? ` | prof=${professionalRecipientId} R$${(professionalAmount / 100).toFixed(2)}` : ' | sem recipient profissional'),
  );

  const rules = [
    {
      recipient_id: platformId,
      type: 'flat',
      amount: platformAmount,
      liable: true,
      charge_processing_fee: true,
    },
  ];

  if (professionalRecipientId) {
    rules.push({
      recipient_id: professionalRecipientId,
      type: 'flat',
      amount: professionalAmount,
      liable: false,
      charge_processing_fee: false,
    });
  }

  return rules;
}

// ── Pedidos ───────────────────────────────────────────────────────────────────

/**
 * Cria um pedido PIX no Pagar.me.
 * @param {object} opts
 * @param {string} opts.code - Código único do pedido (idempotência)
 * @param {number} opts.amountCents - Valor em centavos
 * @param {object} opts.customer - Dados do cliente
 * @param {string} [opts.description] - Descrição do serviço
 * @param {number} [opts.expiresIn] - Expiração em segundos (padrão 900 = 15min)
 * @param {Array}  [opts.splitRules] - Array de split rules
 */
async function createPixOrder({
  code,
  amountCents,
  customer,
  description,
  expiresIn = 900,
  splitRules = [],
}) {
  return apiRequest('POST', '/orders', {
    code,
    customer,
    items: [{
      amount: amountCents,
      description: description || 'Serviço Já!',
      quantity: 1,
      code: 'JA-SRV',
    }],
    payments: [{
      payment_method: 'pix',
      pix: { expires_in: expiresIn },
      amount: amountCents,
      ...(splitRules.length ? { split: splitRules } : {}),
    }],
  });
}

/**
 * Cria um pedido com cartão de crédito no Pagar.me.
 * O card_token deve ter sido gerado no mobile via
 * POST https://api.pagar.me/core/v5/tokens?appId={publicKey}
 */
async function createCardOrder({
  code,
  amountCents,
  customer,
  cardToken,
  installments = 1,
  splitRules = [],
}) {
  return apiRequest('POST', '/orders', {
    code,
    customer,
    items: [{
      amount: amountCents,
      description: 'Serviço Já!',
      quantity: 1,
      code: 'JA-SRV',
    }],
    payments: [{
      payment_method: 'credit_card',
      amount: amountCents,
      credit_card: {
        card_token: cardToken,
        installments,
        statement_descriptor: 'JA SERVICOS',
      },
      ...(splitRules.length ? { split: splitRules } : {}),
    }],
  });
}

/**
 * Busca um pedido pelo ID.
 */
async function getOrder(orderId) {
  return apiRequest('GET', `/orders/${orderId}`);
}

// ── Recebedores ───────────────────────────────────────────────────────────────

/**
 * Cria um recebedor (profissional) no Pagar.me.
 * Transfer automático diário configurado.
 */
async function createRecipient({
  name,
  email,
  document,
  holderName,
  bank,
  branchNumber,
  branchCheckDigit,
  accountNumber,
  accountCheckDigit,
  accountType,
  phone,
}) {
  const doc = String(document || '').replace(/\D/g, '');
  const isCompany = doc.length > 11;

  const phoneDigits = String(phone || '').replace(/\D/g, '');
  const ddd = phoneDigits.slice(0, 2);
  const phoneNum = phoneDigits.slice(2);

  return apiRequest('POST', '/recipients', {
    name,
    email,
    document: doc,
    document_type: isCompany ? 'CNPJ' : 'CPF',
    type: isCompany ? 'company' : 'individual',
    default_bank_account: {
      holder_name: holderName || name,
      holder_type: isCompany ? 'company' : 'individual',
      holder_document: doc,
      bank: String(bank),
      branch_number: String(branchNumber),
      branch_check_digit: String(branchCheckDigit || '0'),
      account_number: String(accountNumber),
      account_check_digit: String(accountCheckDigit),
      type: accountType || 'checking', // 'checking' | 'savings'
    },
    transfer_settings: {
      transfer_enabled: true,
      transfer_interval: 'daily',
      transfer_day: 0,
    },
    register_information: {
      name,
      email,
      document: doc,
      type: isCompany ? 'company' : 'individual',
      ...(ddd && phoneNum
        ? {
          phone_numbers: [{ ddd, number: phoneNum, type: 'mobile' }],
        }
        : {}),
    },
  });
}

// ── Transferências ──────────────────────────────────────────────────────────────

/** * Consulta o saldo do recebedor no Pagar.me.
 * Retorna: { available: R$, waitingFunds: R$, transferred: R$ } (em reais)
 * @param {string} recipientId - ID do recebedor (rcp_...)
 */
async function getRecipientBalance(recipientId) {
  const raw = await apiRequest('GET', `/recipients/${recipientId}/balance`);
  return {
    available: (raw.available?.amount || 0) / 100,
    waitingFunds: (raw.waiting_funds?.amount || 0) / 100,
    transferred: (raw.transferred?.amount || 0) / 100,
  };
}

/** * Transfere um valor do recebedor da plataforma para o recebedor do profissional.
 * Usada após conclusão do serviço para repassar a parte do profissional.
 * @param {string} targetRecipientId - ID do recebedor destino (rcp_...)
 * @param {number} amountCents - Valor em centavos
 */
async function createTransfer(targetRecipientId, amountCents) {
  const sourceId = getPlatformRecipientId();
  if (!sourceId) throw new Error('PAGARME_PLATFORM_RECIPIENT_ID não configurado');
  return apiRequest('POST', '/transfers', {
    amount: amountCents,
    source_id: sourceId,
    target_id: targetRecipientId,
  });
}

// ── Estornos ──────────────────────────────────────────────────────────────────

/**
 * Estorna uma cobrança (parcial ou total).
 * @param {string} chargeId - ID da cobrança (ch_...)
 * @param {number} amountCents - Valor a estornar em centavos
 */
async function refundCharge(chargeId, amountCents) {
  return apiRequest('POST', `/charges/${chargeId}/refund`, {
    amount: amountCents,
  });
}

// ── Exports ───────────────────────────────────────────────────────────────────

module.exports = {
  getMode,
  getSecretKey,
  getPublicKey,
  getPlatformRecipientId,
  isConfigured,
  verifyWebhookAuth,
  verifyWebhookSignature,
  buildSplitRules,
  createPixOrder,
  createCardOrder,
  getOrder,
  createRecipient,
  refundCharge,
  createTransfer,
  getRecipientBalance,
};
