const express = require('express');
const https = require('https');
const router = express.Router();
const ServiceType = require('../models/ServiceType');
const ServiceDemand = require('../models/ServiceDemand');

const GEMINI_TIMEOUT_MS = 20000; // 20 segundos

function callGemini(prompt) {
  return new Promise((resolve, reject) => {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) return reject(new Error('GEMINI_API_KEY não configurado no servidor'));

    const bodyData = JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.1, maxOutputTokens: 512 },
    });

    const options = {
      hostname: 'generativelanguage.googleapis.com',
      path: `/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(bodyData),
      },
      timeout: GEMINI_TIMEOUT_MS,
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          // Gemini retorna { error: { message, status, code } } em caso de chave inválida,
          // quota excedida, etc. Rejeitar explicitamente para expor o erro real nos logs.
          if (json.error) {
            return reject(new Error(`Gemini API error (${json.error.status || res.statusCode}): ${json.error.message}`));
          }
          const finishReason = json.candidates?.[0]?.finishReason;
          const text = json.candidates?.[0]?.content?.parts?.[0]?.text || '';
          if (!text) {
            console.error('[suggest-service] Gemini retornou texto vazio — finishReason:', finishReason, '| estrutura:', JSON.stringify(json).slice(0, 300));
          }
          resolve(text);
        } catch {
          reject(new Error('Falha ao interpretar resposta do Gemini'));
        }
      });
    });

    req.on('timeout', () => {
      req.destroy(new Error('Timeout na chamada ao Gemini'));
    });
    req.on('error', reject);
    req.write(bodyData);
    req.end();
  });
}

// POST /api/suggest-service
// Body: { prompt: string }
// Returns: { matched: true, serviceType, explanation } | { matched: false, message }
router.post('/', async (req, res) => {
  console.log('[suggest-service] recebendo requisição');
  try {
    const userPrompt = String(req.body?.prompt || '').trim().slice(0, 500);
    if (!userPrompt) {
      return res.status(400).json({ message: 'prompt é obrigatório' });
    }

    const serviceTypes = await ServiceType.find({ status: 'enabled' })
      .select('slug name description')
      .lean();

    if (!serviceTypes.length) {
      return res.json({ matched: false, message: 'Nenhum serviço disponível no momento.' });
    }

    const serviceList = serviceTypes
      .map((st) => `- ${st.name} (slug: ${st.slug})${st.description ? ': ' + st.description : ''}`)
      .join('\n');

    const geminiPrompt = `Você é um assistente de correspondência de serviços do aplicativo JÁ!, um marketplace de serviços domésticos no Brasil.

Sua ÚNICA função é verificar se a solicitação do usuário se encaixa em algum dos serviços disponíveis abaixo. Não responda a perguntas sobre outros assuntos.

Serviços disponíveis:
${serviceList}

Regras OBRIGATÓRIAS:
1. Se a solicitação NÃO for relacionada a serviços domésticos ou não corresponder a nenhum serviço listado, retorne EXATAMENTE este JSON:
{"matched":false,"message":"Não identificamos uma profissão que possa te atender com esse problema. Iremos registrar sua solicitação e avaliar a demanda para inserir novas profissões no aplicativo."}

2. Se corresponder a um serviço disponível, retorne EXATAMENTE este JSON:
{"matched":true,"slug":"slug_do_servico","explanation":"Explicação curta em português de por que esse serviço atende à solicitação."}

3. Responda SOMENTE com JSON válido. Sem texto extra, sem markdown, sem blocos de código.

Solicitação do usuário: "${userPrompt}"`;

    const rawText = await callGemini(geminiPrompt);

    // Extrair o objeto JSON da resposta — o Gemini às vezes adiciona texto
    // antes/depois ou retorna blocos de código markdown.
    console.log('[suggest-service] resposta Gemini (200 chars):', rawText.slice(0, 200));
    const jsonMatch = rawText.match(/\{[\s\S]*\}/);

    let parsed;
    if (!jsonMatch) {
      console.error('[suggest-service] JSON não encontrado na resposta:', rawText);
      return res.json({
        matched: false,
        message: 'Não conseguimos interpretar a solicitação. Tente descrever de outra forma.',
      });
    }
    try {
      parsed = JSON.parse(jsonMatch[0]);
    } catch {
      console.error('[suggest-service] falha ao parsear JSON:', jsonMatch[0]);
      return res.json({
        matched: false,
        message: 'Não conseguimos interpretar a solicitação. Tente descrever de outra forma.',
      });
    }

    if (parsed.matched) {
      const serviceType = serviceTypes.find((st) => st.slug === parsed.slug);
      if (!serviceType) {
        // Slug retornado pelo Gemini não existe — registra como demanda
        await ServiceDemand.create({ prompt: userPrompt }).catch(() => {});
        return res.json({
          matched: false,
          message: 'Não identificamos uma profissão disponível para essa solicitação. Iremos registrar e avaliar a demanda.',
        });
      }
      return res.json({ matched: true, serviceType, explanation: parsed.explanation || '' });
    }

    // Sem correspondência — registra a demanda para análise
    await ServiceDemand.create({ prompt: userPrompt }).catch(() => {});

    return res.json({
      matched: false,
      message: parsed.message ||
        'Não identificamos uma profissão que possa te atender com esse problema. Iremos registrar sua solicitação e avaliar a demanda para inserir novas profissões no aplicativo.',
    });
  } catch (err) {
    console.error('[suggest-service] erro:', err.message);
    return res.status(500).json({
      matched: false,
      message: 'Erro ao processar a sugestão. Verifique sua conexão e tente novamente.',
    });
  }
});

module.exports = router;
