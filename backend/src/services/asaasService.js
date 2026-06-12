'use strict';
const https = require('https');

// ── Configuração ──────────────────────────────────────────────────────────────

const SANDBOX_HOST = 'api-sandbox.asaas.com';
const PROD_HOST    = 'api.asaas.com';
const API_PATH     = '/v3';

function getMode() {
  return (process.env.ASAAS_MODE || 'sandbox').trim().toLowerCase();
}

function getApiKey() {
  const mode = getMode();
  const raw = mode === 'production'
    ? process.env.ASAAS_API_KEY_PROD
    : process.env.ASAAS_API_KEY_SANDBOX;
  return raw ? raw.trim() : null;
}

function getHost() {
  return getMode() === 'production' ? PROD_HOST : SANDBOX_HOST;
}

function isConfigured() {
  return Boolean(getApiKey());
}

// ── Cliente HTTP ──────────────────────────────────────────────────────────────

function sanitizeBodyForLog(body) {
  if (!body) return null;
  const safe = { ...body };
  if (safe.creditCard) {
    safe.creditCard = {
      ...safe.creditCard,
      number: safe.creditCard.number ? `****${String(safe.creditCard.number).slice(-4)}` : '****',
      ccv: '***',
    };
  }
  if (safe.creditCardHolderInfo) {
    safe.creditCardHolderInfo = { ...safe.creditCardHolderInfo, cpfCnpj: '***' };
  }
  return JSON.stringify(safe).slice(0, 400);
}

function apiRequest(method, path, body) {
  return new Promise((resolve, reject) => {
    const key = getApiKey();
    if (!key) return reject(new Error('ASAAS_API_KEY não configurada para o modo ' + getMode()));

    const bodyStr = body ? JSON.stringify(body) : null;
    console.info(`[asaas] → ${method} ${API_PATH + path}`, sanitizeBodyForLog(body));

    const options = {
      hostname: getHost(),
      port: 443,
      path: API_PATH + path,
      method,
      headers: {
        'access_token': key,            // Asaas usa header access_token
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'User-Agent': 'JaApp/1.0',
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
          console.error(`[asaas] HTTP ${res.statusCode} ${method} ${API_PATH + path} → ${raw.slice(0, 400)}`);
          const errMsg = parsed?.errors?.[0]?.description
            || parsed?.errors?.[0]?.code
            || parsed?.message
            || `Asaas ${res.statusCode}`;
          const err = new Error(errMsg);
          err.statusCode = res.statusCode;
          err.asaasResponse = parsed;
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

// ── Webhook ───────────────────────────────────────────────────────────────────

/**
 * Verifica se a requisição veio do Asaas.
 * O Asaas envia o token configurado no webhook no header `asaas-access-token`.
 * Se ASAAS_WEBHOOK_TOKEN não estiver configurado, aceita (modo dev).
 */
function verifyWebhookToken(req) {
  const expected = (process.env.ASAAS_WEBHOOK_TOKEN || '').trim();
  if (!expected) {
    console.warn('[asaas] ASAAS_WEBHOOK_TOKEN não configurado — autenticação do webhook ignorada');
    return true;
  }
  const received = (req.headers['asaas-access-token'] || '').trim();
  // Comparação sem timing-safe (token curto de webhook, risco baixo)
  return received === expected;
}

// ── Clientes ─────────────────────────────────────────────────────────────────

/**
 * Cria ou recupera um cliente no Asaas via CPF.
 * Retorna o customerId (cus_xxx) já existente ou recém-criado.
 */
async function findOrCreateCustomer({ name, email, cpf, phone }) {
  const cpfDigits = cpf.replace(/\D/g, '');

  // Tentar buscar cliente existente por CPF
  try {
    const list = await apiRequest('GET', `/customers?cpfCnpj=${cpfDigits}&limit=1`);
    if (list?.data?.length > 0) {
      return list.data[0].id;
    }
  } catch {
    // Se a busca falhar, tentar criar diretamente
  }

  // Criar novo cliente
  const customer = await apiRequest('POST', '/customers', {
    name,
    cpfCnpj: cpfDigits,
    email,
    mobilePhone: (phone || '').replace(/\D/g, ''),
    notificationDisabled: true, // não enviar e-mails do Asaas para o cliente
  });
  return customer.id;
}

// ── Cobranças ─────────────────────────────────────────────────────────────────

/**
 * Cria cobrança PIX no Asaas.
 * @returns objeto completo da cobrança Asaas (incluindo id, status, etc.)
 */
async function createPixPayment({ customerId, value, description, externalReference, dueDateOffsetMinutes = 30 }) {
  const dueDate = new Date(Date.now() + dueDateOffsetMinutes * 60 * 1000)
    .toISOString().split('T')[0]; // YYYY-MM-DD

  return apiRequest('POST', '/payments', {
    customer: customerId,
    billingType: 'PIX',
    value: Number(value.toFixed(2)),
    dueDate,
    description: description || 'Serviço Já!',
    externalReference: externalReference || undefined,
  });
}

/**
 * Cria cobrança com cartão de crédito no Asaas.
 * Os dados do cartão são enviados diretamente (backend→Asaas, PCI DSS do Asaas).
 */
async function createCreditCardPayment({
  customerId,
  value,
  description,
  externalReference,
  // Dados do cartão
  holderName,
  cardNumber,
  expiryMonth,
  expiryYear,
  ccv,
  // Dados do titular
  cpf,
  email,
  phone,
  postalCode,
  addressNumber,
  // Opções
  installments = 1,
  remoteIp,
}) {
  return apiRequest('POST', '/payments', {
    customer: customerId,
    billingType: 'CREDIT_CARD',
    value: Number(value.toFixed(2)),
    dueDate: new Date().toISOString().split('T')[0],
    description: description || 'Serviço Já!',
    externalReference: externalReference || undefined,
    installmentCount: installments > 1 ? installments : undefined,
    creditCard: {
      holderName,
      number: cardNumber.replace(/\s/g, ''),
      expiryMonth: String(expiryMonth).padStart(2, '0'),
      expiryYear: String(expiryYear).length === 2 ? '20' + expiryYear : String(expiryYear),
      ccv,
    },
    creditCardHolderInfo: {
      name: holderName,
      email,
      cpfCnpj: cpf.replace(/\D/g, ''),
      postalCode: (postalCode || '').replace(/\D/g, '') || '00000000',
      addressNumber: addressNumber || 'S/N',
      phone: (phone || '').replace(/\D/g, ''),
    },
    remoteIp: remoteIp || '0.0.0.0',
  });
}

/**
 * Cobra com token de cartão salvo (sem re-enviar dados sensíveis).
 */
async function createCreditCardPaymentWithToken({
  customerId,
  value,
  description,
  externalReference,
  creditCardToken,
  installments = 1,
}) {
  return apiRequest('POST', '/payments', {
    customer: customerId,
    billingType: 'CREDIT_CARD',
    value: Number(value.toFixed(2)),
    dueDate: new Date().toISOString().split('T')[0],
    description: description || 'Serviço Já!',
    externalReference: externalReference || undefined,
    installmentCount: installments > 1 ? installments : undefined,
    creditCardToken,
  });
}

/**
 * Recupera uma cobrança pelo ID do Asaas.
 */
async function getPayment(paymentId) {
  return apiRequest('GET', `/payments/${paymentId}`);
}

/**
 * Retorna o QR Code PIX de uma cobrança.
 * Resposta: { encodedImage, payload, expirationDate }
 *   encodedImage = base64 PNG do QR
 *   payload      = EMV (copia e cola)
 */
async function getPixQrCode(paymentId) {
  return apiRequest('GET', `/payments/${paymentId}/pixQrCode`);
}

/**
 * Estorna uma cobrança.
 */
async function refundPayment(paymentId) {
  return apiRequest('POST', `/payments/${paymentId}/refund`);
}

// ── Financeiro ────────────────────────────────────────────────────────────────

/**
 * Retorna o saldo da conta Asaas.
 * Resposta: { balance, totalOutTransfers, ... }
 */
async function getAccountBalance() {
  const result = await apiRequest('GET', '/finance/balance');
  return {
    balance: result?.balance ?? 0,
    totalOutTransfers: result?.totalOutTransfers ?? 0,
  };
}

// ── Transferências (saque do profissional) ────────────────────────────────────

/**
 * Transfere valor da conta Asaas para chave PIX (CPF) do profissional.
 * @param {string} pixKey   - CPF do profissional (apenas dígitos)
 * @param {number} value    - Valor em R$
 * @param {string} description
 */
async function transferToPixKey(pixKey, value, description = 'Saque profissional') {
  return apiRequest('POST', '/transfers', {
    value: Number(value.toFixed(2)),
    pixAddressKey: pixKey.replace(/\D/g, ''),
    pixAddressKeyType: 'CPF',
    description,
  });
}

/**
 * Transfere valor para qualquer tipo de chave PIX.
 * @param {string} pixKey      - Chave PIX (CNPJ, CPF, e-mail, chave aleatória)
 * @param {string} pixKeyType  - CNPJ | CPF | EMAIL | EVP
 * @param {number} value       - Valor em R$
 * @param {string} description
 */
async function transferToPixKeyTyped(pixKey, pixKeyType, value, description = 'Repasse') {
  // Para CNPJ/CPF remove não-dígitos; para EMAIL/EVP mantém o valor como está
  const normalizedKey = ['CNPJ', 'CPF'].includes(String(pixKeyType).toUpperCase())
    ? pixKey.replace(/\D/g, '')
    : pixKey.trim();
  return apiRequest('POST', '/transfers', {
    value: Number(value.toFixed(2)),
    pixAddressKey: normalizedKey,
    pixAddressKeyType: String(pixKeyType).toUpperCase(),
    description,
  });
}

/**
 * Transfere via conta bancária (TED/PIX por dados bancários).
 */
async function transferToBankAccount({ value, bank, accountType, account, accountDigit, agency, agencyDigit, cpf, name, description }) {
  return apiRequest('POST', '/transfers', {
    value: Number(value.toFixed(2)),
    bankAccount: {
      bank: { code: bank },
      accountName: name,
      ownerName: name,
      cpfCnpj: cpf.replace(/\D/g, ''),
      agency,
      agencyDigit: agencyDigit || undefined,
      account,
      accountDigit,
      bankAccountType: accountType === 'savings' ? 'CONTA_POUPANCA' : 'CONTA_CORRENTE',
    },
    description: description || 'Saque profissional',
  });
}

/**
 * Verifica o token do webhook de validação de saque.
 * O Asaas envia o token configurado no header `asaas-access-token`.
 * Token configurado em: ASAAS_TRANSFER_WEBHOOK_TOKEN (separado do webhook de cobranças).
 * Se não configurado, aceita (modo dev).
 */
function verifyTransferWebhookToken(req) {
  const expected = (process.env.ASAAS_TRANSFER_WEBHOOK_TOKEN || '').trim();
  if (!expected) {
    console.warn('[asaas] ASAAS_TRANSFER_WEBHOOK_TOKEN não configurado — validação de token ignorada');
    return true;
  }
  const received = (req.headers['asaas-access-token'] || '').trim();
  return received === expected;
}

// ── Exports ───────────────────────────────────────────────────────────────────

module.exports = {
  getMode,
  getApiKey,
  isConfigured,
  verifyWebhookToken,
  verifyTransferWebhookToken,
  findOrCreateCustomer,
  createPixPayment,
  createCreditCardPayment,
  createCreditCardPaymentWithToken,
  getPayment,
  getPixQrCode,
  refundPayment,
  getAccountBalance,
  transferToPixKey,
  transferToPixKeyTyped,
  transferToBankAccount,
};
