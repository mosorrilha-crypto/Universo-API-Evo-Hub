import { sendWhatsAppTextMessage } from './metaSend';

/** Atraso realista de digitação antes de cada bolha — mesma lógica usada no whatsapp-agent-monique. */
function calcularAtrasoDigitacao(texto: string): number {
  const CARACTERES_POR_SEGUNDO = 12;
  const MIN_MS = 900;
  const MAX_MS = 3500;
  const estimado = (texto.length / CARACTERES_POR_SEGUNDO) * 1000;
  return Math.min(MAX_MS, Math.max(MIN_MS, estimado));
}

/**
 * Envia uma resposta fracionada em várias "bolhas" curtas, uma de cada vez,
 * com um atraso entre elas que simula alguém digitando — em vez de despejar
 * tudo de uma vez (o que denunciaria na hora que é um agente automático).
 */
export async function sendBubbles(
  phoneNumberId: string | undefined,
  accessToken: string | undefined,
  to: string,
  bubbles: string[],
  onBubbleSent: (text: string) => void
): Promise<void> {
  for (const bubble of bubbles) {
    if (!bubble.trim()) continue;
    await new Promise((resolve) => setTimeout(resolve, calcularAtrasoDigitacao(bubble)));
    await sendWhatsAppTextMessage(phoneNumberId, accessToken, to, bubble);
    onBubbleSent(bubble);
  }
}
