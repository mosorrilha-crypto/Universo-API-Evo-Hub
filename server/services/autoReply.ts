import type { GoogleGenAI } from '@google/genai';

/**
 * Gera uma resposta automática curta e natural pra uma mensagem de texto
 * recebida no WhatsApp, no mesmo estilo de atendimento comercial usado pela
 * transcrição de áudio (server/services/geminiTranscription.ts). Sem
 * fallback simulado aqui: se o Gemini falhar, simplesmente não respondemos
 * automaticamente (melhor não responder do que responder algo genérico/errado
 * pra um cliente real).
 */
export async function generateAutoReplyForText(
  ai: GoogleGenAI | null,
  text: string,
  contactName?: string
): Promise<string | null> {
  if (!ai || !text.trim()) return null;

  try {
    const prompt = `Você é um atendente de WhatsApp de um negócio real, respondendo diretamente ao cliente.
Responda de forma curta (1-3 frases), natural, cordial e no mesmo idioma da mensagem do cliente.
Não invente preços, horários ou dados específicos que você não tem — nesse caso, diga que vai confirmar e retornar em breve.
${contactName ? `Nome do cliente: ${contactName}.` : ''}
Mensagem do cliente: "${text}"
Responda apenas com o texto da resposta, sem aspas, sem JSON, sem explicações.`;

    const response = await ai.models.generateContent({
      model: 'gemini-3.6-flash',
      contents: [{ text: prompt }],
    });

    const reply = (response.text || '').trim();
    return reply || null;
  } catch (err) {
    console.warn('Gemini Auto-Reply (texto) error:', err);
    return null;
  }
}
