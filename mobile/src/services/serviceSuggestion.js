const normalize = (value = '') => String(value)
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .trim()
  .toLowerCase();

const DEFAULT_KEYWORDS = {
  diarista: ['diarista', 'limpeza', 'faxina', 'passar roupa', 'lavar', 'casa limpa', 'limpar casa', 'cozinha', 'banheiro'],
  petwalker: ['pet walker', 'dog walker', 'cachorro', 'passeio com cachorro', 'levar cachorro', 'passear cachorro', 'animal'],
  babá: ['babá', 'baby sitter', 'crianca', 'criança', 'cuidar de criança'],
  jardineiro: ['jardim', 'grama', 'plantas', 'jardinagem'],
  eletricista: ['eletrica', 'elétrica', 'tomada', 'chuveiro', 'disjuntor', 'energia', 'fiação'],
  encanador: ['encanamento', 'vazamento', 'torneira', 'pia', 'banheiro', 'cano', 'agua'],
  pintor: ['pintura', 'pintar parede', 'tinta', 'reforma'],
  montador: ['montagem', 'montar', 'armário', 'rack', 'móvel'],
};

const DEFAULT_SERVICE_FALLBACKS = [
  { slug: 'diarista', name: 'Diarista' },
  { slug: 'petwalker', name: 'Pet Walker' },
  { slug: 'babá', name: 'Babá' },
  { slug: 'encanador', name: 'Encanador' },
  { slug: 'eletricista', name: 'Eletricista' },
];

const googleGeminiEnabled = () => Boolean(process.env.EXPO_PUBLIC_GEMINI_API_KEY);

function pickByHeuristic(prompt = '', serviceTypes = []) {
  const text = normalize(prompt);
  if (!text) return null;

  const indexed = serviceTypes
    .map((st) => ({
      ...st,
      normalizedName: normalize(st?.name),
      normalizedSlug: normalize(st?.slug),
      normalizedDescription: normalize(st?.description),
    }))
    .filter((st) => st?.slug);

  let best = null;
  let bestScore = 0;

  for (const st of indexed) {
    let score = 0;
    if (text.includes(st.normalizedName)) score += 8;
    if (text.includes(st.normalizedSlug)) score += 6;
    if (st.normalizedDescription && text.includes(st.normalizedDescription)) score += 2;

    const keywords = [
      ...(DEFAULT_KEYWORDS[st.normalizedSlug] || []),
      ...(DEFAULT_KEYWORDS[st.normalizedName] || []),
    ].map(normalize);

    for (const keyword of keywords) {
      if (keyword && text.includes(keyword)) score += 3;
    }

    if (score > bestScore) {
      bestScore = score;
      best = st;
    }
  }

  if (best) return best;

  for (const fallback of DEFAULT_SERVICE_FALLBACKS) {
    if (text.includes(fallback.slug) || text.includes(normalize(fallback.name))) {
      return serviceTypes.find((st) => normalize(st?.slug) === normalize(fallback.slug) || normalize(st?.name) === normalize(fallback.name)) || fallback;
    }
  }

  return serviceTypes[0] || null;
}

async function suggestServiceType(prompt = '', serviceTypes = []) {
  const cleanedPrompt = String(prompt || '').trim();
  const availableServices = Array.isArray(serviceTypes) ? serviceTypes.filter((st) => st?.slug) : [];

  if (!cleanedPrompt) {
    return {
      serviceType: availableServices[0] || null,
      explanation: 'Digite o que você precisa para receber uma sugestão.',
      confidence: 0,
      source: 'empty',
    };
  }

  if (googleGeminiEnabled()) {
    try {
      const catalog = availableServices.map((st) => ({
        slug: st.slug,
        name: st.name,
        description: st.description || '',
      }));

      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${process.env.EXPO_PUBLIC_GEMINI_API_KEY}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [
              {
                role: 'user',
                parts: [
                  {
                    text: [
                      'Você é um assistente que escolhe a melhor categoria de serviço para um pedido doméstico.',
                      'Responda SOMENTE em JSON válido, sem texto extra, no formato:',
                      '{"slug":"...","name":"...","explanation":"...","confidence":0.0}',
                      'Se a solicitação não se encaixar perfeitamente, escolha a opção mais próxima disponível.',
                      'Catálogo de serviços:',
                      JSON.stringify(catalog),
                      'Pedido do usuário:',
                      cleanedPrompt,
                    ].join('\n'),
                  },
                ],
              },
            ],
            generationConfig: {
              temperature: 0.2,
              responseMimeType: 'application/json',
            },
          }),
        }
      );

      const json = await response.json();
      const raw = json?.candidates?.[0]?.content?.parts?.[0]?.text || '';
      const parsed = raw ? JSON.parse(raw) : null;
      const matched = availableServices.find((st) => String(st.slug).toLowerCase() === String(parsed?.slug || '').toLowerCase())
        || availableServices.find((st) => String(st.name).toLowerCase() === String(parsed?.name || '').toLowerCase())
        || null;

      if (matched) {
        return {
          serviceType: matched,
          explanation: parsed?.explanation || `Sugestão para: ${matched.name}`,
          confidence: Number(parsed?.confidence || 0.75),
          source: 'gemini',
        };
      }
    } catch {
      // cai para heurística
    }
  }

  const heuristic = pickByHeuristic(cleanedPrompt, availableServices);
  if (heuristic) {
    return {
      serviceType: heuristic,
      explanation: `Sugestão baseada no seu pedido: ${heuristic.name}`,
      confidence: 0.6,
      source: 'heuristic',
    };
  }

  return {
    serviceType: availableServices[0] || null,
    explanation: 'Não consegui identificar com precisão. Escolha uma opção manualmente.',
    confidence: 0.3,
    source: 'fallback',
  };
}

export { suggestServiceType };
