import api from './api';

/**
 * Envia o texto do usuário ao backend, que consulta o Gemini
 * e retorna a sugestão de serviço mais adequada (ou informa que
 * nenhuma profissão foi identificada e registra a demanda).
 *
 * @param {string} prompt  Texto livre digitado pelo usuário
 * @returns {Promise<{ matched: boolean, serviceType?: object, explanation?: string, message?: string }>}
 */
export async function suggestServiceType(prompt) {
  const { data } = await api.post('/suggest-service', { prompt });
  return data;
}
