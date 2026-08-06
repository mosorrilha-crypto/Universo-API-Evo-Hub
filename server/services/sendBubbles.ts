import { sendWhatsAppTextMessage, markAsReadAndShowTyping } from './metaSend';
import type { ConversationPhase } from './autoReply';

/**
 * Multiplicador de atraso por fase da conversa — pensado pra conversão:
 * rápido na abertura e no fechamento (onde fricção de espera custa a venda),
 * mais devagar tirando dúvida técnica ou lidando com objeção (onde parecer
 * "pensativo" transmite atenção genuína em vez de resposta automática).
 */
const PHASE_MULTIPLIER: Record<ConversationPhase, number> = {
  abertura: 0.8,
  fechamento: 0.8,
  informacao: 1.6,
  objecao: 1.9,
};

/** Atraso realista de digitação antes de cada bolha — mesma lógica usada no whatsapp-agent-monique, ajustado por fase. */
function calcularAtrasoDigitacao(texto: string, phase: ConversationPhase): number {
  const CARACTERES_POR_SEGUNDO = 12;
  const MIN_MS = 900;
  const MAX_MS = 3500;
  const estimado = (texto.length / CARACTERES_POR_SEGUNDO) * 1000 * PHASE_MULTIPLIER[phase];
  return Math.min(MAX_MS * PHASE_MULTIPLIER[phase], Math.max(MIN_MS, estimado));
}

/**
 * Envia uma resposta fracionada em várias "bolhas" curtas, uma de cada vez,
 * com um atraso entre elas que simula alguém digitando — em vez de despejar
 * tudo de uma vez (o que denunciaria na hora que é um agente automático).
 * Reativa o indicador "digitando..." antes de cada bolha (ele expira em 25s,
 * então uma resposta com várias bolhas precisa renová-lo a cada uma).
 */
export async function sendBubbles(
  phoneNumberId: string | undefined,
  accessToken: string | undefined,
  to: string,
  bubbles: string[],
  onBubbleSent: (text: string) => void | Promise<void>,
  incomingMessageId?: string,
  phase: ConversationPhase = 'informacao',
  /** ms já gastos antes de chegar aqui (ex: chamada de roteamento) — descontado só da 1ª bolha, pra não somar a latência do router ao tempo total de resposta. */
  preElapsedMs = 0
): Promise<void> {
  let remainingCompensation = preElapsedMs;
  for (const bubble of bubbles) {
    if (!bubble.trim()) continue;
    await markAsReadAndShowTyping(phoneNumberId, accessToken, incomingMessageId);
    const delay = Math.max(0, calcularAtrasoDigitacao(bubble, phase) - remainingCompensation);
    remainingCompensation = 0; // só desconta da primeira bolha
    await new Promise((resolve) => setTimeout(resolve, delay));
    await sendWhatsAppTextMessage(phoneNumberId, accessToken, to, bubble);
    await onBubbleSent(bubble);
  }
}
