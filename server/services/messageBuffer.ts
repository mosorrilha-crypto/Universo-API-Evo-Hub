/**
 * Agrupa mensagens de texto picotadas (2-3 mensagens rápidas seguidas do
 * mesmo número) antes de disparar a resposta automática — espera um período
 * de silêncio antes de processar tudo junto, em vez de responder cada
 * fragmento separadamente (o que denunciaria na hora que é um agente
 * automático). Mesmo princípio do buffer.js do whatsapp-agent-monique.
 */
const SILENCE_MS = 6000;

interface PendingBuffer {
  texts: string[];
  contactName: string | undefined;
  lastMessageId: string;
  timer: ReturnType<typeof setTimeout>;
}

const buffers = new Map<string, PendingBuffer>();

export function bufferIncomingText(
  phone: string,
  contactName: string | undefined,
  text: string,
  messageId: string,
  onFlush: (combinedText: string, contactName: string | undefined, lastMessageId: string, messageCount: number) => void
) {
  const existing = buffers.get(phone);
  if (existing) clearTimeout(existing.timer);

  const texts = existing ? [...existing.texts, text] : [text];
  const buffer: PendingBuffer = {
    texts,
    contactName: contactName || existing?.contactName,
    lastMessageId: messageId,
    timer: setTimeout(() => {
      buffers.delete(phone);
      onFlush(buffer.texts.join('\n'), buffer.contactName, buffer.lastMessageId, buffer.texts.length);
    }, SILENCE_MS),
  };
  buffers.set(phone, buffer);
}
