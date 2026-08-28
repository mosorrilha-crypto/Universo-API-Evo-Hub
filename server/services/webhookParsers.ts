/**
 * Parsers dos dois formatos de webhook de WhatsApp que o app recebe:
 * Meta Cloud API (oficial) e Evolution API (self-hosted). Cada um extrai um
 * formato comum (ParsedIncomingMessage) pra alimentar a fila de transcrição,
 * independente de qual provedor originou o evento.
 */
import { normalizeConversationPhone } from './phoneNormalization';

export interface ParsedIncomingMessage {
  provider: 'meta' | 'evolution' | 'instagram';
  messageId: string;
  from: string;
  contactName?: string;
  /** phone_number_id da Meta — o número do NEGÓCIO que recebeu a mensagem (não o do cliente). Usado pra resolver de qual tenant é essa mensagem (Bloco 2.B). Ausente em mensagens via Evolution (self-hosted, sem esse conceito). */
  phoneNumberId?: string;
  /** Nome da instância Evolution API (`body.instance`) — equivalente ao phoneNumberId acima, mas pra Porta A (Epic 4.6, self-hosted/QR Code). Ausente em mensagens via Meta. */
  instanceName?: string;
  /** ID da conta Instagram que recebeu a mensagem (`entry[].id`) — equivalente ao phoneNumberId/instanceName acima, mas pra Instagram DM (Fase 1, 15/08/2026). Ausente em mensagens via WhatsApp. */
  instagramAccountId?: string;
  type: 'audio' | 'text' | 'image' | 'other';
  /** Tipo bruto do WhatsApp quando type==='other' (ex: "sticker", "video", "location", "contacts") — usado pra mostrar um rótulo específico no painel em vez de "[other]" genérico. Ver friendlyLabelForOtherType. */
  rawType?: string;
  text?: string;
  /** Legenda digitada junto da imagem (type === 'image', Meta `image.caption` ou Baileys `imageMessage.caption`) — achado real (28/08/2026): a legenda nunca era extraída do payload, então a mensagem gravada na conversa mostrava só "📷 Imagem recebida", descartando o texto que o cliente escreveu junto da foto. */
  caption?: string;
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
  /** true quando o evento é fromMe (só Evolution API — Baileys espelha TODA atividade do número conectado, inclusive nosso próprio envio via API). Nunca deve disparar resposta automática/escalonamento — ver outboundEchoTracker.ts em webhooks.ts pra distinguir eco do nosso envio de mensagem mandada direto do celular. */
  fromMe?: true;
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
      const phoneNumberId: string | undefined = value?.metadata?.phone_number_id;

      for (const msg of messages) {
        if (!msg?.id || !msg?.from) continue;

        const base: Omit<ParsedIncomingMessage, 'type'> = {
          provider: 'meta',
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
        } else if (msg.type === 'button' && msg.button?.text) {
          // Resposta a um botão quick-reply de TEMPLATE (ver
          // sendWhatsAppTemplateMessage com buttonPayloads, reminderJob.ts) —
          // formato diferente do `interactive.button_reply` acima: a Meta
          // manda `button.text`/`button.payload`, não `interactive`. Tratada
          // igual, pelo mesmo motivo.
          parsed.push({ ...base, type: 'text', text: msg.button.text });
        } else if (msg.type === 'image' && msg.image?.id) {
          parsed.push({
            ...base,
            type: 'image',
            metaImage: { mediaId: msg.image.id, mimeType: msg.image.mime_type },
            ...(typeof msg.image.caption === 'string' && msg.image.caption.trim() ? { caption: msg.image.caption.trim() } : {}),
          });
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
    case 'instagram_attachment':
      return '📎 Anexo do Instagram recebido';
    default:
      return `[${rawType || 'other'}]`;
  }
}

/**
 * Instagram DM (Fase 1, 15/08/2026) — mesma "família" de webhook da Meta
 * (Messenger Platform), payload em `entry[].messaging[]`, estrutura
 * DIFERENTE de `entry[].changes[].value.messages[]` usada pela Meta Cloud
 * API/WhatsApp. Referência: https://developers.facebook.com/docs/messenger-platform/instagram/features/webhook
 *
 * `message.is_echo: true` marca um evento espelhando uma mensagem que a
 * PRÓPRIA conta mandou (via API ou direto pelo app do Instagram) — mesmo
 * papel do `fromMe` da Evolution API (Baileys): nunca deve disparar resposta
 * automática, só vira mensagem de operador quando não é eco do nosso próprio
 * envio (ver outboundEchoTracker.ts em webhooks.ts).
 *
 * Fase 1 só lida com texto — anexo (imagem/áudio/story reply etc.) vira tipo
 * "other" com rótulo amigável (friendlyLabelForOtherType), sem download nem
 * resposta automática, igual outros tipos não suportados dos outros
 * provedores.
 */
export function parseInstagramWebhookPayload(body: any): ParsedIncomingMessage[] {
  const parsed: ParsedIncomingMessage[] = [];
  if (body?.object !== 'instagram') return parsed;

  for (const entry of body.entry || []) {
    const instagramAccountId: string | undefined = entry.id;

    for (const event of entry.messaging || []) {
      const messageId: string | undefined = event.message?.mid;
      const from: string | undefined = event.sender?.id;
      if (!messageId || !from) continue;

      const base: Omit<ParsedIncomingMessage, 'type'> = {
        provider: 'instagram',
        messageId,
        from,
        instagramAccountId,
        ...(event.message?.is_echo ? { fromMe: true as const } : {}),
      };

      if (typeof event.message?.text === 'string' && event.message.text) {
        parsed.push({ ...base, type: 'text', text: event.message.text });
      } else {
        parsed.push({ ...base, type: 'other', rawType: 'instagram_attachment' });
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
  if (!data?.key?.id) return [];

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
  // Migração de privacidade em rollout progressivo do WhatsApp: em vez do JID
  // de telefone tradicional (`@s.whatsapp.net`), a conversa pode vir
  // endereçada por um identificador opaco (`@lid`) — confirmado em produção
  // (15/08/2026, tenant Clic Piscinas) e documentado como bug ativo/conhecido
  // na comunidade Baileys/Evolution API (base da nossa Evolution API):
  // https://github.com/WhiskeySockets/Baileys/issues/1718. Sem tratar isso,
  // `from` vira o número opaco do @lid (não o telefone real), criando uma
  // conversa NOVA duplicada pro mesmo lead a cada vez que o WhatsApp decide
  // endereçar por esse identificador em vez do de telefone. Quando isso
  // acontece, o Baileys expõe o telefone real em `key.remoteJidAlt` — usa
  // esse fallback quando presente; sem ele, cai pro valor opaco (mesmo
  // comportamento de antes, sem regressão).
  const rawFrom: string = remoteJid.endsWith('@lid') && data.key.remoteJidAlt
    ? String(data.key.remoteJidAlt).split('@')[0]
    : remoteJid.split('@')[0];
  const from = normalizeConversationPhone(rawFrom);
  const contactName: string | undefined = data.pushName;
  const message = data.message || {};

  const base: Omit<ParsedIncomingMessage, 'type'> = {
    provider: 'evolution',
    messageId,
    from,
    contactName,
    instanceName: body.instance,
    ...(data.key.fromMe ? { fromMe: true as const } : {}),
  };

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
    return [{
      ...base,
      type: 'image',
      evolutionImage: true,
      ...(typeof message.imageMessage.caption === 'string' && message.imageMessage.caption.trim() ? { caption: message.imageMessage.caption.trim() } : {}),
    }];
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
