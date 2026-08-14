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
  /** Tipo bruto do WhatsApp quando type==='other' (ex: "sticker", "video", "location", "contacts") — usado pra mostrar um rótulo específico no painel em vez de "[other]" genérico. Ver friendlyLabelForOtherType. */
  rawType?: string;
  text?: string;
  /** Presente quando type === 'audio' via Meta Cloud API. */
  metaAudio?: { mediaId: string; mimeType?: string };
  /** Presente quando type === 'image' via Meta Cloud API. */
  metaImage?: { mediaId: string; mimeType?: string };
  /** Presente quando type === 'audio' via Evolution API. */
  evolutionAudio?: { url?: string; mediaKey?: string; mimeType?: string };
  /** true quando type === 'image' via Evolution API — sem URL/mediaKey úteis aqui (mídia ponta-a-ponta criptografada), o download reconstrói a message key a partir de messageId/from, mesmo padrão já usado pra evolutionAudio (ver downloadEvolutionMedia). */
  evolutionImage?: true;
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
        } else if (msg.type === 'interactive' && msg.interactive?.button_reply?.title) {
          // Resposta a um botão (ver sendWhatsAppInteractiveButtons, metaSend.ts) —
          // tratada igual a mensagem de texto normal: o resto do pipeline
          // (router, especialista, ferramentas de agenda) nem precisa saber
          // que veio de um toque em botão em vez de digitação.
          parsed.push({ ...base, type: 'text', text: msg.interactive.button_reply.title });
        } else if (msg.type === 'image' && msg.image?.id) {
          parsed.push({ ...base, type: 'image', metaImage: { mediaId: msg.image.id, mimeType: msg.image.mime_type } });
        } else {
          parsed.push({ ...base, type: 'other', rawType: msg.type });
        }
      }
    }
  }

  return parsed;
}

/**
 * Rótulo amigável pro painel quando a mensagem é de um tipo que não geramos
 * resposta automática (sticker, vídeo/gif, localização, contato etc.) — sem
 * isso o operador via só "[sticker]"/"[video]" cru na lista de conversas.
 * Achado real em produção: lead mandou um sticker/reação e a conversa
 * mostrava um placeholder sem sentido nenhum.
 */
export function friendlyLabelForOtherType(rawType: string | undefined): string {
  switch (rawType) {
    case 'sticker':
      return '🏷️ Figurinha recebida';
    case 'video':
      // WhatsApp não tem um tipo "gif" próprio — um GIF enviado pelo cliente
      // chega como video (mp4 curto em loop).
      return '🎬 Vídeo/GIF recebido';
    case 'location':
      return '📍 Localização recebida';
    case 'contacts':
      return '👤 Contato recebido';
    case 'reaction':
      return '❤️ Reagiu a uma mensagem';
    case 'button':
    case 'interactive':
      return '👆 Resposta de botão recebida';
    case 'document':
      return '📎 Documento recebido';
    default:
      return `[${rawType || 'other'}]`;
  }
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

  const remoteJid: string = String(data.key.remoteJid || '');
  // Mensagem de grupo do WhatsApp (JID termina em "@g.us") — nunca deve virar
  // lead/conversa: é bate-papo de grupo, não atendimento 1:1 com cliente.
  // Achado real: sem esse filtro, o ID numérico do grupo (formato
  // "120363...") virava "telefone" do lead, poluindo a lista de conversas
  // com assunto de grupo sem relação nenhuma com o negócio — e imagem de
  // grupo nunca tinha como baixar (nenhum campo de mídia é populado pra esse
  // tipo), gerando "Imagem indisponível" pra sempre.
  if (remoteJid.endsWith('@g.us')) return [];

  const messageId: string = data.key.id;
  const from: string = remoteJid.split('@')[0];
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
    return [{ ...base, type: 'image', evolutionImage: true }];
  }

  const rawType = message.stickerMessage
    ? 'sticker'
    : message.videoMessage
    ? 'video'
    : message.locationMessage
    ? 'location'
    : message.contactMessage
    ? 'contacts'
    : message.reactionMessage
    ? 'reaction'
    : message.documentMessage
    ? 'document'
    : undefined;
  return [{ ...base, type: 'other', rawType }];
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
