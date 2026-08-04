/**
 * Parsers dos dois formatos de webhook de WhatsApp que o app recebe:
 * Meta Cloud API (oficial) e Evolution API (self-hosted). Cada um extrai um
 * formato comum (ParsedIncomingMessage) pra alimentar a fila de transcrição,
 * independente de qual provedor originou o evento.
 */

export interface ParsedIncomingMessage {
  provider: 'meta' | 'evolution';
  messageId: string;
  from: string;
  contactName?: string;
  type: 'audio' | 'text' | 'image' | 'other';
  text?: string;
  /** Presente quando type === 'audio' via Meta Cloud API. */
  metaAudio?: { mediaId: string; mimeType?: string };
  /** Presente quando type === 'audio' via Evolution API. */
  evolutionAudio?: { url?: string; mediaKey?: string; mimeType?: string };
}

/**
 * Meta Cloud API manda o payload dentro de entry[].changes[].value.messages[].
 * Referência: https://developers.facebook.com/docs/whatsapp/cloud-api/webhooks/payload-examples
 */
export function parseMetaWebhookPayload(body: any): ParsedIncomingMessage[] {
  const parsed: ParsedIncomingMessage[] = [];
  if (body?.object !== 'whatsapp_business_account') return parsed;

  for (const entry of body.entry || []) {
    for (const change of entry.changes || []) {
      const value = change.value;
      const messages = value?.messages;
      if (!Array.isArray(messages)) continue;

      const contactsByWaId = new Map<string, string>();
      for (const contact of value.contacts || []) {
        if (contact?.wa_id) contactsByWaId.set(contact.wa_id, contact.profile?.name);
      }

      for (const msg of messages) {
        if (!msg?.id || !msg?.from) continue;

        const base: Omit<ParsedIncomingMessage, 'type'> = {
          provider: 'meta',
          messageId: msg.id,
          from: msg.from,
          contactName: contactsByWaId.get(msg.from),
        };

        if (msg.type === 'audio' && msg.audio?.id) {
          parsed.push({ ...base, type: 'audio', metaAudio: { mediaId: msg.audio.id, mimeType: msg.audio.mime_type } });
        } else if (msg.type === 'text' && msg.text?.body) {
          parsed.push({ ...base, type: 'text', text: msg.text.body });
        } else if (msg.type === 'image') {
          parsed.push({ ...base, type: 'image' });
        } else {
          parsed.push({ ...base, type: 'other' });
        }
      }
    }
  }

  return parsed;
}

/**
 * Evolution API v2 manda o evento MESSAGES_UPSERT (ou "messages.upsert",
 * dependendo da versão/config) com a mensagem em data.message. O áudio real
 * (criptografado ponta-a-ponta pelo protocolo do WhatsApp) não vem inline —
 * só a mediaKey/url; buscar os bytes de verdade exige chamar de volta a API
 * da própria instância Evolution (ver server/services/mediaDownload.ts).
 */
export function parseEvolutionWebhookPayload(body: any): ParsedIncomingMessage[] {
  if (!body?.event && !body?.instance) return [];
  const eventName = String(body.event || '').toLowerCase();
  if (eventName && !eventName.includes('messages.upsert') && !eventName.includes('messages_upsert')) {
    return [];
  }

  const data = body.data;
  if (!data?.key?.id || data?.key?.fromMe) return [];

  const messageId: string = data.key.id;
  const from: string = String(data.key.remoteJid || '').split('@')[0];
  const contactName: string | undefined = data.pushName;
  const message = data.message || {};

  const base: Omit<ParsedIncomingMessage, 'type'> = { provider: 'evolution', messageId, from, contactName };

  if (message.audioMessage) {
    return [{
      ...base,
      type: 'audio',
      evolutionAudio: {
        url: message.audioMessage.url,
        mediaKey: message.audioMessage.mediaKey,
        mimeType: message.audioMessage.mimetype,
      },
    }];
  }

  if (message.conversation || message.extendedTextMessage?.text) {
    return [{ ...base, type: 'text', text: message.conversation || message.extendedTextMessage.text }];
  }

  if (message.imageMessage) {
    return [{ ...base, type: 'image' }];
  }

  return [{ ...base, type: 'other' }];
}
