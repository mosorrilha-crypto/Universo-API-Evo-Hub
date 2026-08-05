import type { GoogleGenAI } from '@google/genai';

const GEMINI_TIMEOUT_MS = 20000;

async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Gemini demorou mais de ${ms}ms — abortando.`)), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer!);
  }
}

/**
 * Gera uma resposta automática curta e natural pra uma mensagem de texto
 * recebida no WhatsApp, no mesmo estilo de atendimento comercial usado pela
 * transcrição de áudio (server/services/geminiTranscription.ts). Sem
 * fallback simulado aqui: se o Gemini falhar, simplesmente não respondemos
 * automaticamente (melhor não responder do que responder algo genérico/errado
 * pra um cliente real).
 *
 * `history` traz as últimas mensagens da conversa (mais antiga primeiro) pra
 * o modelo ter memória real — sem isso, cada mensagem parece a primeira da
 * conversa e o agente "se apresenta" do zero a cada resposta.
 */
export async function generateAutoReplyForText(
  ai: GoogleGenAI | null,
  text: string,
  contactName?: string,
  knowledgeBaseContext?: string,
  history?: { sender: 'lead' | 'agent'; text?: string }[]
): Promise<string | null> {
  if (!ai || !text.trim()) return null;

  try {
    const historyText = (history || [])
      .filter((m) => m.text)
      .slice(-10)
      .map((m) => `${m.sender === 'lead' ? 'Cliente' : 'Atendente'}: ${m.text}`)
      .join('\n');

    const prompt = `Você é um atendente de WhatsApp de um negócio real, respondendo diretamente ao cliente.
Responda de forma curta (1-3 frases), natural, cordial e no mesmo idioma da mensagem do cliente.
Não invente preços, horários ou dados específicos que você não tem — nesse caso, diga que vai confirmar e retornar em breve.
${contactName ? `Nome do cliente: ${contactName}.` : ''}
${knowledgeBaseContext || ''}
${historyText ? `Histórico recente da conversa (mais antiga primeiro):\n${historyText}\n` : ''}
Nova mensagem do cliente: "${text}"
Responda apenas com o texto da resposta, sem aspas, sem JSON, sem explicações. Se o histórico já mostra que vocês já se falaram, não se apresente de novo — continue a conversa naturalmente.`;

    const response = await withTimeout(
      ai.models.generateContent({
        model: 'gemini-3.6-flash',
        contents: [{ text: prompt }],
      }),
      GEMINI_TIMEOUT_MS
    );

    const reply = (response.text || '').trim();
    if (!reply) console.warn('⚠️  Gemini Auto-Reply (texto): resposta vazia, nada enviado.');
    return reply || null;
  } catch (err) {
    console.warn('Gemini Auto-Reply (texto) error:', err);
    return null;
  }
}
