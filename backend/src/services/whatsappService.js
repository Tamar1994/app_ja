/**
 * whatsappService.js
 *
 * Integração com a Meta Cloud API (WhatsApp Business).
 * Usa apenas o módulo nativo `https` — sem dependências extras.
 *
 * Variáveis de ambiente necessárias (.env):
 *   WHATSAPP_PHONE_NUMBER_ID  — ID do número no Meta Developer
 *   WHATSAPP_ACCESS_TOKEN     — Token permanente (System User) do Meta Developer
 *
 * Templates que devem ser criados no WhatsApp Manager (business.facebook.com):
 *   1. otp_verificacao       — Categoria: AUTHENTICATION  — ver abaixo
 *   2. lembrete_agendamento  — Categoria: UTILITY         — ver abaixo
 *   3. servico_aceito        — Categoria: UTILITY         — ver abaixo
 *
 * Conteúdo dos templates (cadastrar exatamente assim no Meta):
 * ─────────────────────────────────────────────────────────────
 * [otp_verificacao] — AUTHENTICATION
 *   Corpo: Seu código de verificação Já! é *{{1}}*. Válido por 15 minutos.
 *          Não compartilhe este código com ninguém.
 *
 * [lembrete_agendamento] — UTILITY
 *   Corpo: Olá, {{1}}! ⏰ Lembrete: seu serviço de *{{2}}* está agendado
 *          para *{{3}}*. O profissional já está confirmado. Qualquer dúvida,
 *          abra o app Já!
 *
 * [servico_aceito] — UTILITY
 *   Corpo: Olá, {{1}}! ✅ Seu serviço de *{{2}}* foi aceito. O profissional
 *          está a caminho. Acompanhe em tempo real pelo app Já!
 *
 * [cadastro_aprovado] — UTILITY  (profissionais e upgrade de cliente para profissional)
 *   Corpo: Olá, {{1}}! 🎉 Seu cadastro no Já! foi aprovado. Agora você já
 *          pode começar a atender clientes. Bons atendimentos!
 *
 * [cadastro_aprovado_cliente] — UTILITY  (clientes puros aprovados)
 *   Corpo: Olá, {{1}}! 🎉 Sua conta no Já! foi aprovada. Agora você já
 *          pode solicitar serviços. Seja bem-vindo!
 * ─────────────────────────────────────────────────────────────
 */

'use strict';

const https  = require('https');
const logger = require('../utils/logger');

const PHONE_NUMBER_ID = process.env.WHATSAPP_PHONE_NUMBER_ID;
const ACCESS_TOKEN    = process.env.WHATSAPP_ACCESS_TOKEN;
const GRAPH_VERSION   = 'v21.0';

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Normaliza um telefone brasileiro para E.164 sem o "+".
 * Entrada aceita: (11) 99999-9999, 11999999999, 5511999999999, +5511999999999
 * Saída: 5511999999999
 */
function normalizeBrPhone(raw = '') {
  const digits = String(raw).replace(/\D/g, '');

  // Já está no formato internacional com código do Brasil
  if (digits.startsWith('55') && digits.length >= 12) return digits;

  // Número nacional (com ou sem 0 inicial)
  const national = digits.replace(/^0+/, '');
  return `55${national}`;
}

/**
 * Chamada HTTP à Graph API do Meta.
 */
function callGraphAPI(endpoint, body) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const options = {
      hostname: 'graph.facebook.com',
      path: `/${GRAPH_VERSION}/${endpoint}`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
        Authorization: `Bearer ${ACCESS_TOKEN}`,
      },
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (parsed.error) {
            reject(new Error(`WhatsApp API error ${parsed.error.code}: ${parsed.error.message}`));
          } else {
            resolve(parsed);
          }
        } catch {
          reject(new Error(`WhatsApp API resposta inválida: ${data}`));
        }
      });
    });

    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

/**
 * Verifica se o serviço está configurado.
 * Retorna false silenciosamente (sem lançar erro) para não bloquear outros fluxos.
 */
function isConfigured() {
  if (!PHONE_NUMBER_ID || !ACCESS_TOKEN) {
    logger.warn('[whatsapp] Serviço não configurado — WHATSAPP_PHONE_NUMBER_ID ou WHATSAPP_ACCESS_TOKEN ausentes');
    return false;
  }
  return true;
}

// ─── Funções públicas ─────────────────────────────────────────────────────────

/**
 * Envia código OTP de verificação.
 * Template: otp_verificacao (AUTHENTICATION)
 *
 * @param {string} phone  Telefone do usuário (qualquer formato brasileiro)
 * @param {string} code   Código de 6 dígitos
 */
async function sendOTP(phone, code) {
  if (!isConfigured()) return;

  const to = normalizeBrPhone(phone);
  try {
    await callGraphAPI(`${PHONE_NUMBER_ID}/messages`, {
      messaging_product: 'whatsapp',
      to,
      type: 'template',
      template: {
        name: 'otp_verificacao',
        language: { code: 'pt_BR' },
        components: [
          {
            type: 'body',
            parameters: [{ type: 'text', text: code }],
          },
        ],
      },
    });
    logger.info('[whatsapp] OTP enviado', { to });
  } catch (err) {
    // Falha silenciosa — o e-mail já foi enviado como fallback
    logger.warn('[whatsapp] Falha ao enviar OTP', { to, err: err.message });
  }
}

/**
 * Envia lembrete 1h antes de serviço agendado.
 * Template: lembrete_agendamento (UTILITY)
 *
 * @param {string} phone          Telefone do destinatário
 * @param {string} userName       Nome do cliente ou profissional
 * @param {string} serviceType    Nome do serviço (ex: "Diarista")
 * @param {Date}   scheduledDate  Data/hora do serviço
 */
async function sendScheduledReminder(phone, userName, serviceType, scheduledDate) {
  if (!isConfigured()) return;

  const to = normalizeBrPhone(phone);
  const formatted = new Date(scheduledDate).toLocaleString('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    weekday: 'long',
    day: '2-digit',
    month: 'long',
    hour: '2-digit',
    minute: '2-digit',
  });

  try {
    await callGraphAPI(`${PHONE_NUMBER_ID}/messages`, {
      messaging_product: 'whatsapp',
      to,
      type: 'template',
      template: {
        name: 'lembrete_agendamento',
        language: { code: 'pt_BR' },
        components: [
          {
            type: 'body',
            parameters: [
              { type: 'text', text: userName },
              { type: 'text', text: serviceType },
              { type: 'text', text: formatted },
            ],
          },
        ],
      },
    });
    logger.info('[whatsapp] Lembrete de agendamento enviado', { to, scheduledDate });
  } catch (err) {
    logger.warn('[whatsapp] Falha ao enviar lembrete', { to, err: err.message });
  }
}

/**
 * Envia notificação de serviço aceito pelo profissional.
 * Template: servico_aceito (UTILITY)
 *
 * @param {string} phone        Telefone do cliente
 * @param {string} clientName   Nome do cliente
 * @param {string} serviceType  Nome do serviço
 */
async function sendServiceAccepted(phone, clientName, serviceType) {
  if (!isConfigured()) return;

  const to = normalizeBrPhone(phone);
  try {
    await callGraphAPI(`${PHONE_NUMBER_ID}/messages`, {
      messaging_product: 'whatsapp',
      to,
      type: 'template',
      template: {
        name: 'servico_aceito_ptbr',
        language: { code: 'pt_BR' },
        components: [
          {
            type: 'body',
            parameters: [
              { type: 'text', text: clientName },
              { type: 'text', text: serviceType },
            ],
          },
        ],
      },
    });
    logger.info('[whatsapp] Notificação de aceite enviada', { to });
  } catch (err) {
    logger.warn('[whatsapp] Falha ao enviar notificação de aceite', { to, err: err.message });
  }
}

/**
 * Envia notificação de aprovação de cadastro.
 * Templates: cadastro_aprovado (profissional) | cadastro_aprovado_cliente (cliente puro)
 *
 * @param {string}  phone          Telefone do usuário
 * @param {string}  name           Nome do usuário
 * @param {boolean} isProfessional true = profissional ou upgrade; false = cliente puro
 */
async function sendRegistrationApproved(phone, name, isProfessional = true) {
  if (!isConfigured()) return;

  const to           = normalizeBrPhone(phone);
  const templateName = isProfessional ? 'cadastro_aprovado_profissional' : 'cadastro_aprovado_cliente';

  try {
    await callGraphAPI(`${PHONE_NUMBER_ID}/messages`, {
      messaging_product: 'whatsapp',
      to,
      type: 'template',
      template: {
        name: templateName,
        language: { code: 'pt_BR' },
        components: [
          {
            type: 'body',
            parameters: [
              { type: 'text', text: name.split(' ')[0] },
            ],
          },
        ],
      },
    });
    logger.info('[whatsapp] Notificação de aprovação enviada', { to, templateName });
  } catch (err) {
    logger.warn('[whatsapp] Falha ao enviar aprovação', { to, templateName, err: err.message });
  }
}

module.exports = { sendOTP, sendScheduledReminder, sendServiceAccepted, sendRegistrationApproved, normalizeBrPhone };
