/**
 * Agrupa mensagens de texto picotadas (2-3 mensagens rápidas seguidas do
 * mesmo número) antes de disparar a resposta automática — espera um período
 * de silêncio antes de processar tudo junto, em vez de responder cada
 * fragmento separadamente (o que denunciaria na hora que é um agente
 * automático). Mesmo princípio do buffer.js do whatsapp-agent-monique.
 */
import type { ResolvedTenant } from './tenantResolver';

const SILENCE_MS = 6000;

interface PendingBuffer {
  texts: string[];
  contactName: string | undefined;
  lastMessageId: string;
  /** Tenant resolvido (Bloco 2.B) da mensagem mais recente do lote — usado ao disparar a resposta automática pro grupo inteiro. */
  resolvedTenant: ResolvedTenant;
  timer: ReturnType<typeof setTimeout>;
}

const buffers = new Map<string, PendingBuffer>();

export function bufferIncomingText(
  phone: string,
  contactName: string | undefined,
  text: string,
  messageId: string,
  resolvedTenant: ResolvedTenant,
  onFlush: (combinedText: string, contactName: string | undefined, lastMessageId: string, messageCount: number, resolvedTenant: ResolvedTenant) => void
) {
  const existing = buffers.get(phone);
  if (existing) clearTimeout(existing.timer);

  const texts = existing ? [...existing.texts, text] : [text];
  const buffer: PendingBuffer = {
    texts,
    contactName: contactName || existing?.contactName,
    lastMessageId: messageId,
    resolvedTenant,
    timer: setTimeout(() => {
      buffers.delete(phone);
      onFlush(buffer.texts.join('\n'), buffer.contactName, buffer.lastMessageId, buffer.texts.length, buffer.resolvedTenant);
    }, SILENCE_MS),
  };
  buffers.set(phone, buffer);
}
