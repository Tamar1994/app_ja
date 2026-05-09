const fs = require('fs');
const path = require('path');
const https = require('https');
const { URL } = require('url');
const { randomUUID } = require('crypto');

const CORA_ENV = (process.env.CORA_ENV || 'stage').toLowerCase();
const CORA_CLIENT_ID = process.env.CORA_CLIENT_ID || '';

const DEFAULT_BASE_URL = CORA_ENV === 'production'
  ? 'https://matls-clients.api.cora.com.br'
  : 'https://matls-clients.api.stage.cora.com.br';

const CORA_BASE_URL = process.env.CORA_BASE_URL || DEFAULT_BASE_URL;
const CORA_TOKEN_PATH = process.env.CORA_TOKEN_PATH || '/token';
const CORA_PIX_INVOICE_PATH = process.env.CORA_PIX_INVOICE_PATH || '/v2/invoices';
const CORA_INVOICE_DETAILS_PATH_TEMPLATE = process.env.CORA_INVOICE_DETAILS_PATH_TEMPLATE || '/v2/invoices/{id}';
const CORA_WEBHOOK_ENDPOINTS_PATH = process.env.CORA_WEBHOOK_ENDPOINTS_PATH || '/endpoints';
const CORA_TRANSFER_PATH = process.env.CORA_TRANSFER_PATH || '/transfers/initiate';

const DEFAULT_CERT_PATH = path.resolve(__dirname, '../../cert/certificate.pem');
const DEFAULT_KEY_PATH = path.resolve(__dirname, '../../cert/private-key.key');
const CORA_CERT_PATH = process.env.CORA_CERT_PATH || DEFAULT_CERT_PATH;
const CORA_KEY_PATH = process.env.CORA_KEY_PATH || DEFAULT_KEY_PATH;
const CORA_CERT_PEM = process.env.CORA_CERT_PEM || '';
const CORA_KEY_PEM = process.env.CORA_KEY_PEM || '';
const CORA_CERT_B64 = process.env.CORA_CERT_B64 || '';
const CORA_KEY_B64 = process.env.CORA_KEY_B64 || '';

let cachedToken = null;
let cachedTokenExpiryMs = 0;

function hasCoraConfigured() {
  const hasEnvPem = Boolean(CORA_CERT_PEM) && Boolean(CORA_KEY_PEM);
  const hasEnvB64 = Boolean(CORA_CERT_B64) && Boolean(CORA_KEY_B64);
  const hasFilePair = fs.existsSync(CORA_CERT_PATH) && fs.existsSync(CORA_KEY_PATH);
  return Boolean(CORA_CLIENT_ID) && (hasEnvPem || hasEnvB64 || hasFilePair);
}

function loadMtlsCredentials() {
  if (!hasCoraConfigured()) {
    throw new Error('Cora nao configurada: defina CORA_CLIENT_ID e forneca cert/key por arquivo (CORA_CERT_PATH/CORA_KEY_PATH), PEM (CORA_CERT_PEM/CORA_KEY_PEM) ou Base64 (CORA_CERT_B64/CORA_KEY_B64)');
  }

  if (CORA_CERT_PEM && CORA_KEY_PEM) {
    return {
      cert: Buffer.from(CORA_CERT_PEM, 'utf8'),
      key: Buffer.from(CORA_KEY_PEM, 'utf8'),
    };
  }

  if (CORA_CERT_B64 && CORA_KEY_B64) {
    return {
      cert: Buffer.from(CORA_CERT_B64, 'base64'),
      key: Buffer.from(CORA_KEY_B64, 'base64'),
    };
  }

  return {
    cert: fs.readFileSync(CORA_CERT_PATH),
    key: fs.readFileSync(CORA_KEY_PATH),
  };
}

function buildUrl(pathname) {
  const base = new URL(CORA_BASE_URL);
  base.pathname = pathname;
  return base;
}

function requestJson({ method, pathname, headers = {}, body = null, token = null }) {
  const url = buildUrl(pathname);
  const creds = loadMtlsCredentials();

  return new Promise((resolve, reject) => {
    const req = https.request({
      method,
      hostname: url.hostname,
      port: url.port || 443,
      path: `${url.pathname}${url.search}`,
      cert: creds.cert,
      key: creds.key,
      headers: {
        accept: 'application/json',
        ...headers,
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
    }, (res) => {
      let raw = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => {
        raw += chunk;
      });
      res.on('end', () => {
        const status = res.statusCode || 500;
        const ok = status >= 200 && status < 300;

        let parsed = null;
        if (raw) {
          try {
            parsed = JSON.parse(raw);
          } catch {
            parsed = raw;
          }
        }

        if (!ok) {
          const message = typeof parsed === 'string'
            ? parsed
            : parsed?.message || `Erro Cora (${status})`;
          const err = new Error(message);
          err.status = status;
          err.response = parsed;
          reject(err);
          return;
        }

        resolve(parsed || {});
      });
    });

    req.on('error', reject);

    if (body) {
      req.write(body);
    }

    req.end();
  });
}

async function getAccessToken() {
  const now = Date.now();
  if (cachedToken && now < cachedTokenExpiryMs) {
    return cachedToken;
  }

  const form = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: CORA_CLIENT_ID,
  }).toString();

  const data = await requestJson({
    method: 'POST',
    pathname: CORA_TOKEN_PATH,
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      'content-length': Buffer.byteLength(form),
    },
    body: form,
  });

  cachedToken = data.access_token;
  const expiresInSeconds = Number(data.expires_in || 300);
  cachedTokenExpiryMs = now + Math.max(10, expiresInSeconds - 30) * 1000;
  return cachedToken;
}

function buildInvoicePayload({
  amountCents,
  code,
  customer,
  serviceDescription,
  dueDate,
}) {
  return {
    code,
    customer: {
      name: customer.name,
      email: customer.email,
      document: {
        identity: customer.document,
        type: customer.documentType || 'CPF',
      },
    },
    services: [{
      name: 'Servico Ja',
      description: serviceDescription || 'Pagamento de servico contratado no app Ja',
      amount: amountCents,
    }],
    payment_terms: {
      due_date: dueDate,
    },
    payment_forms: ['PIX'],
  };
}

async function createPixInvoice({ amountCents, customer, code, serviceDescription, dueDate }) {
  const token = await getAccessToken();
  const payload = buildInvoicePayload({ amountCents, code, customer, serviceDescription, dueDate });
  const body = JSON.stringify(payload);

  const data = await requestJson({
    method: 'POST',
    pathname: CORA_PIX_INVOICE_PATH,
    token,
    headers: {
      'content-type': 'application/json',
      'content-length': Buffer.byteLength(body),
      'Idempotency-Key': randomUUID(),
    },
    body,
  });

  return {
    invoiceId: data.id,
    status: data.status,
    emv: data?.pix?.emv || null,
    qrCodeUrl: data?.payment_options?.bank_slip?.url || null,
    raw: data,
  };
}

function buildInvoiceDetailsPath(invoiceId) {
  return CORA_INVOICE_DETAILS_PATH_TEMPLATE.replace('{id}', encodeURIComponent(invoiceId));
}

async function getInvoice(invoiceId) {
  const token = await getAccessToken();
  return requestJson({
    method: 'GET',
    pathname: buildInvoiceDetailsPath(invoiceId),
    token,
    headers: {
      'content-type': 'application/json',
    },
  });
}

async function createWebhookEndpoint({ url, resource = 'invoice', trigger = 'paid' }) {
  const token = await getAccessToken();
  const body = JSON.stringify({ url, resource, trigger });

  return requestJson({
    method: 'POST',
    pathname: CORA_WEBHOOK_ENDPOINTS_PATH,
    token,
    headers: {
      'content-type': 'application/json',
      'content-length': Buffer.byteLength(body),
      'Idempotency-Key': randomUUID(),
    },
    body,
  });
}

async function initiateTransfer({ destination, amount, description, code, category, scheduled }) {
  const token = await getAccessToken();
  const body = JSON.stringify({ destination, amount, description, code, category, scheduled });

  return requestJson({
    method: 'POST',
    pathname: CORA_TRANSFER_PATH,
    token,
    headers: {
      'content-type': 'application/json',
      'content-length': Buffer.byteLength(body),
      'Idempotency-Key': randomUUID(),
    },
    body,
  });
}

module.exports = {
  hasCoraConfigured,
  getAccessToken,
  createPixInvoice,
  getInvoice,
  createWebhookEndpoint,
  initiateTransfer,
};
