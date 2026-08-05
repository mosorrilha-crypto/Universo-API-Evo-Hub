import type { GoogleGenAI } from '@google/genai';

const GEMINI_TIMEOUT_MS = 20000;

export type ConversationPhase = 'abertura' | 'informacao' | 'objecao' | 'fechamento';

export interface AutoReplyResult {
  phase: ConversationPhase;
  bubbles: string[];
}

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
 * Gera a resposta automática já fracionada em "bolhas" curtas (1 a 3
 * mensagens), no estilo de atendimento humano real de WhatsApp — não um
 * bloco único tipo e-mail. Baseado nas diretrizes consolidadas de
 * posicionamento pro agente (fracionamento, dialeto/tom local vindo da Base
 * de Conhecimento, empatia antes de credenciais, sem "speech" de vendedor).
 *
 * Também classifica a fase da conversa (abertura/informação/objeção/
 * fechamento) na MESMA chamada — sem custo extra de latência ou API — pra
 * o chamador (server/services/sendBubbles.ts) ajustar o ritmo do atraso de
 * digitação de acordo com o momento certo pra conversão.
 *
 * Sem fallback simulado: se o Gemini falhar, simplesmente não respondemos
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
): Promise<AutoReplyResult | null> {
  if (!ai || !text.trim()) return null;

  try {
    const historyText = (history || [])
      .filter((m) => m.text)
      .slice(-10)
      .map((m) => `${m.sender === 'lead' ? 'Cliente' : 'Atendente'}: ${m.text}`)
      .join('\n');

    const prompt = `Você é a pessoa real que atende o WhatsApp de um negócio — não um robô, não uma IA se apresentando como tal. A resposta precisa ser indistinguível de uma pessoa de verdade digitando no celular.

REGRAS DE ESTILO (sempre aplicar):
1. Fracione a resposta em 1 a 3 "bolhas" curtas e sequenciais (como mensagens reais de WhatsApp), nunca um bloco único tipo e-mail/panfleto.
2. Adapte vocabulário, saudações e tom ao idioma/dialeto do cliente e ao "toneOfVoice" abaixo (se vier voseo, gírias regionais, diminutivos — use-os naturalmente).
3. Empatia e foco no benefício primeiro — nunca abra com currículo, dados técnicos ou lista de qualificações. Valide o desejo/dúvida do cliente antes de qualquer coisa.
4. Prefira perguntas abertas de diálogo a despejar informação toda de uma vez.
5. Não invente preços, horários ou dados específicos que não estão no contexto — nesse caso, diga que vai confirmar e retornar em breve.
6. Se o histórico mostra que vocês já se falaram, NUNCA se apresente de novo — continue a conversa naturalmente, como quem lembra o que já foi dito.
7. Pode usar leve leveza/humor quando cabível, mas sempre com segurança e sem soar debochado.

${contactName ? `Nome do cliente: ${contactName}.` : ''}
${knowledgeBaseContext || ''}
${historyText ? `Histórico recente da conversa (mais antiga primeiro):\n${historyText}\n` : ''}
Nova mensagem do cliente: "${text}"

Classifique também a fase atual desta conversa em UMA destas opções:
- "abertura": primeiro contato, saudação, cliente ainda curioso/explorando.
- "informacao": tirando dúvida técnica, pergunta sobre preço/procedimento/disponibilidade.
- "objecao": cliente hesitante, com medo, dúvida sobre resultado, ou pedindo desconto/"vou pensar".
- "fechamento": cliente decidido, confirmando nome/horário, pronto pra agendar.

Responda ESTRITAMENTE em JSON no formato:
{"phase": "abertura|informacao|objecao|fechamento", "bubbles": ["primeira bolha curta", "segunda bolha curta (se precisar)", "terceira bolha curta (se precisar)"]}
Cada bolha deve ter no máximo 1-2 frases. Use só as bolhas necessárias (pode ser só 1).`;

    const response = await withTimeout(
      ai.models.generateContent({
        model: 'gemini-3.6-flash',
        contents: [{ text: prompt }],
        config: { responseMimeType: 'application/json' },
      }),
      GEMINI_TIMEOUT_MS
    );

    const rawText = response.text || '';
    const parsed = JSON.parse(rawText) as { phase?: string; bubbles?: string[] };
    const bubbles = (parsed.bubbles || []).map((b) => b.trim()).filter(Boolean);
    const validPhases: ConversationPhase[] = ['abertura', 'informacao', 'objecao', 'fechamento'];
    const phase = validPhases.includes(parsed.phase as ConversationPhase) ? (parsed.phase as ConversationPhase) : 'informacao';

    if (!bubbles.length) {
      console.warn('⚠️  Gemini Auto-Reply: resposta vazia, nada enviado.');
      return null;
    }
    return { phase, bubbles };
  } catch (err) {
    console.warn('Gemini Auto-Reply (texto) error:', err);
    return null;
  }
}
