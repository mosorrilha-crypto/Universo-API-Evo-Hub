/**
 * Parsers dos dois formatos de webhook de WhatsApp que o app recebe:
 * Meta Cloud API (oficial) e Evolution API (self-hosted). Cada um extrai um
 * formato comum (ParsedIncomingMessage) pra alimentar a fila de transcrição,
 * independente de qual provedor originou o evento.
 */

export interface ParsedIncomingMessage {
  provider: 'meta' | 'evolution' | 'evohub';
  messageId: string;
  from: string;
  contactName?: string;
  /** phone_number_id da Meta — o número do NEGÓCIO que recebeu a mensagem (não o do cliente). Usado pra resolver de qual tenant é essa mensagem (Bloco 2.B). Ausente em mensagens via Evolution (self-hosted, sem esse conceito). */
  phoneNumberId?: string;
  /** Nome da instância Evolution API (`body.instance`) — equivalente ao phoneNumberId acima, mas pra Porta A (Epic 4.6, self-hosted/QR Code). Ausente em mensagens via Meta/Evo Hub. */
  instanceName?: string;
  type: 'audio' | 'text' | 'image' | 'other';
  text?: string;
  /** Presente quando type === 'audio' via Meta Cloud API. */
  metaAudio?: { mediaId: string; mimeType?: string };
  /** Presente quando type === 'image' via Meta Cloud API. */
  metaImage?: { mediaId: string; mimeType?: string };
  /** Presente quando type === 'audio' via Evolution API. */
  evolutionAudio?: { url?: string; mediaKey?: string; mimeType?: string };
  /** Presente quando a mensagem veio de um anúncio "Clique para WhatsApp" (Meta Cloud API) — usado pra atribuição real no Meta Conversions API (Epic 4.5.6). */
  referral?: { headline?: string; sourceId?: string; ctwaClid?: string };
}

/**
 * Meta Cloud API manda o payload dentro de entry[].changes[].value.messages[].
 * Referência: https://developers.facebook.com/docs/whatsapp/cloud-api/webhooks/payload-examples
 *
 * O Evo Hub, no modo BYO (Bring Your Own Meta App), repassa esse mesmo formato
 * de mensagem sem alterar a estrutura (passthrough) — só muda quem assina o
 * HMAC do webhook (nosso webhook_secret, não o META_APP_SECRET) e como a mídia
 * é baixada depois (ver server/services/mediaDownload.ts). Por isso o parser
 * é o mesmo, com o provider identificando de onde a mensagem veio.
 */
export function parseMetaWebhookPayload(body: any, provider: 'meta' | 'evohub' = 'meta'): ParsedIncomingMessage[] {
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
      const phoneNumberId: string | undefined = value?.metadata?.phone_number_id;

      for (const msg of messages) {
        if (!msg?.id || !msg?.from) continue;

        const base: Omit<ParsedIncomingMessage, 'type'> = {
          provider,
          messageId: msg.id,
          from: msg.from,
          contactName: contactsByWaId.get(msg.from),
          phoneNumberId,
          ...(msg.referral
            ? { referral: { headline: msg.referral.headline, sourceId: msg.referral.source_id, ctwaClid: msg.referral.ctwa_clid } }
            : {}),
        };

        if (msg.type === 'audio' && msg.audio?.id) {
          parsed.push({ ...base, type: 'audio', metaAudio: { mediaId: msg.audio.id, mimeType: msg.audio.mime_type } });
        } else if (msg.type === 'text' && msg.text?.body) {
          parsed.push({ ...base, type: 'text', text: msg.text.body });
        } else if (msg.type === 'image' && msg.image?.id) {
          parsed.push({ ...base, type: 'image', metaImage: { mediaId: msg.image.id, mimeType: msg.image.mime_type } });
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

  const base: Omit<ParsedIncomingMessage, 'type'> = { provider: 'evolution', messageId, from, contactName, instanceName: body.instance };

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

/**
 * Eventos de ciclo de vida do Evo Hub (ex.: canal conectado/desconectado,
 * template aprovado) não são mensagens do WhatsApp — são avisos administrativos
 * sobre o canal em si. A documentação do Hub mostra dois formatos de envelope
 * pra esse tipo de evento em seções diferentes: `{event, properties}` numa
 * seção e `{event_type, meta_connection}` no guia de integração. Aceitamos os
 * dois até confirmar qual é o real com um evento de verdade chegando.
 */
export function parseEvoHubLifecycleEvent(body: any): { eventName: string; details: unknown } | null {
  if (body?.object === 'whatsapp_business_account') return null; // mensagem normal, não é lifecycle
  const eventName = body?.event || body?.event_type;
  if (!eventName) return null;
  return { eventName: String(eventName), details: body.properties ?? body.meta_connection ?? body };
}
