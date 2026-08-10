import crypto from 'crypto';

/**
 * Marca a mensagem recebida como lida e ativa o indicador "digitando..." no
 * celular do cliente — mesmo mecanismo usado no whatsapp-agent-monique
 * (lib/whatsapp.js: markAsRead + sendTypingIndicator). Válido por até 25s;
 * como nossa geração de resposta (Gemini + delays de bolha) pode passar
 * disso, chamamos de novo por segurança logo antes de cada bolha ser enviada
 * (ver server/services/sendBubbles.ts). Falha aqui nunca deve travar o envio
 * real da resposta — por isso engole erros silenciosamente.
 */
export async function markAsReadAndShowTyping(
  phoneNumberId: string | undefined,
  accessToken: string | undefined,
  messageId: string | undefined
): Promise<void> {
  if (!phoneNumberId || !accessToken || !messageId) return;
  try {
    await fetch(`https://graph.facebook.com/v23.0/${phoneNumberId}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        status: 'read',
        message_id: messageId,
        typing_indicator: { type: 'text' },
      }),
    });
  } catch (err) {
    console.warn('⚠️  Falha ao mostrar indicador de digitação:', (err as Error).message);
  }
}

/**
 * Código de erro que a Meta devolve quando a conta está com restrição
 * geográfica ativa (ex: WABA/negócio ainda não passou pela Verificação de
 * Negócio e está bloqueada de enviar mensagens business-initiated pra
 * certos países). Mesma constante usada no whatsapp-agent-monique
 * (lib/whatsapp.js). Ver: https://developers.facebook.com/docs/whatsapp/cloud-api/support/error-codes/
 */
export const ERROR_CODE_GEO_RESTRICTED = 130497;

/** Detecta se um erro lançado pelas funções deste arquivo é especificamente a restrição geográfica (130497). */
export function isGeoRestrictedError(err: unknown): boolean {
  return (err as any)?.metaErrorCode === ERROR_CODE_GEO_RESTRICTED;
}

async function throwMetaError(res: Response, contextMsg: string): Promise<never> {
  const data = await res.json().catch(() => ({}) as any);
  const errorMsg = data?.error?.message || `${contextMsg}: HTTP ${res.status}`;
  const error: any = new Error(errorMsg);
  error.metaErrorCode = data?.error?.code;
  throw error;
}

/**
 * Envio de mensagem de texto via Meta Cloud API (POST /{phone-number-id}/messages).
 * Referência: https://developers.facebook.com/docs/whatsapp/cloud-api/reference/messages
 */
export async function sendWhatsAppTextMessage(
  phoneNumberId: string | undefined,
  accessToken: string | undefined,
  to: string,
  text: string
): Promise<void> {
  if (!phoneNumberId || !accessToken) {
    throw new Error('META_PHONE_NUMBER_ID ou META_ACCESS_TOKEN ausentes — não é possível enviar mensagem via Meta Cloud API.');
  }

  const res = await fetch(`https://graph.facebook.com/v23.0/${phoneNumberId}/messages`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to,
      type: 'text',
      text: { body: text },
    }),
  });

  if (!res.ok) {
    await throwMetaError(res, 'Falha ao enviar mensagem via Meta Cloud API');
  }
}

/**
 * Envio de mensagem via template aprovado da Meta (POST /{phone-number-id}/messages,
 * type "template") — diferente de sendWhatsAppTextMessage, funciona mesmo fora da
 * janela de 24h de mensagem business-initiated (é exatamente pra isso que templates
 * existem). Usado pelo alerta de agente pausado (issue #115): o admin normalmente
 * não tem conversa ativa recente com o número comercial, então texto livre falharia.
 * Só suporta parâmetros de texto no corpo, na ordem de {{1}}, {{2}}, ... — suficiente
 * pro uso atual; sem suporte a cabeçalho/botão dinâmico por enquanto.
 * Referência: https://developers.facebook.com/docs/whatsapp/cloud-api/guides/send-message-templates
 */
export async function sendWhatsAppTemplateMessage(
  phoneNumberId: string | undefined,
  accessToken: string | undefined,
  to: string,
  templateName: string,
  languageCode: string,
  bodyParams: string[]
): Promise<void> {
  if (!phoneNumberId || !accessToken) {
    throw new Error('META_PHONE_NUMBER_ID ou META_ACCESS_TOKEN ausentes — não é possível enviar mensagem via Meta Cloud API.');
  }

  const res = await fetch(`https://graph.facebook.com/v23.0/${phoneNumberId}/messages`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to,
      type: 'template',
      template: {
        name: templateName,
        language: { code: languageCode },
        components: bodyParams.length
          ? [{ type: 'body', parameters: bodyParams.map((text) => ({ type: 'text', text })) }]
          : undefined,
      },
    }),
  });

  if (!res.ok) {
    await throwMetaError(res, 'Falha ao enviar mensagem via template (Meta Cloud API)');
  }
}

/**
 * Upload de mídia (foto/documento escolhido no painel) antes de poder
 * referenciá-la numa mensagem — mesmo padrão do whatsapp-agent-monique
 * (lib/whatsapp.js: uploadMedia). Retorna o media_id da Meta.
 *
 * Achado real: O FormData nativo do Node/Undici (usado pelo fetch global)
 * não lida bem com a serialização de Blobs se não for montado com cuidado
 * no ambiente do servidor, resultando em "application/octet-stream" na Meta.
 * Montamos o multipart manualmente para garantir que o boundary e os
 * headers de cada parte (especialmente o Content-Type) sejam explícitos.
 *
 * Bug crítico corrigido (PR #138): o campo "type" no multipart estava sendo
 * enviado como categoria genérica ("audio", "image", "document") em vez do
 * MIME type completo ("audio/ogg", "image/jpeg", etc.). A documentação da
 * Meta (https://developers.facebook.com/docs/whatsapp/cloud-api/reference/media)
 * especifica que o campo "type" deve ser o MIME type do arquivo — não a
 * categoria. Isso fazia a Meta classificar o arquivo como
 * "application/octet-stream" internamente, causando a rejeição silenciosa
 * do áudio (enviava 200 mas o áudio nunca tocava no destinatário).
 *
 * Bug crítico corrigido (PR #138): `crypto` era usado sem ser importado —
 * o global `crypto` do Node 22 é a Web Crypto API (sem `randomBytes`),
 * causando TypeError em runtime ao tentar gerar o boundary do multipart.
 */
export async function uploadWhatsAppMedia(
  phoneNumberId: string | undefined,
  accessToken: string | undefined,
  base64: string,
  mimeType: string,
  filename: string
): Promise<string> {
  if (!phoneNumberId || !accessToken) {
    throw new Error('META_PHONE_NUMBER_ID ou META_ACCESS_TOKEN ausentes — não é possível enviar mídia via Meta Cloud API.');
  }

  const cleanBase64 = base64.replace(/^data:[^;]+;base64,/, '');
  const buffer = Buffer.from(cleanBase64, 'base64');

  // O campo "type" da Meta deve ser o MIME type completo (ex: "audio/ogg"),
  // não a categoria genérica ("audio"). Ver documentação:
  // https://developers.facebook.com/docs/whatsapp/cloud-api/reference/media
  const cleanMimeType = mimeType.split(';')[0].trim();
  const boundary = `----WebKitFormBoundary${crypto.randomBytes(8).toString('hex')}`;

  const chunks: Buffer[] = [];

  // 1. messaging_product
  chunks.push(Buffer.from(`--${boundary}\r\n`));
  chunks.push(Buffer.from(`Content-Disposition: form-data; name="messaging_product"\r\n\r\n`));
  chunks.push(Buffer.from(`whatsapp\r\n`));

  // 2. type — MIME type completo, conforme documentação da Meta
  chunks.push(Buffer.from(`--${boundary}\r\n`));
  chunks.push(Buffer.from(`Content-Disposition: form-data; name="type"\r\n\r\n`));
  chunks.push(Buffer.from(`${cleanMimeType}\r\n`));

  // 3. file — Content-Type aqui é o que a Meta usa para validar o arquivo
  chunks.push(Buffer.from(`--${boundary}\r\n`));
  chunks.push(Buffer.from(`Content-Disposition: form-data; name="file"; filename="${filename}"\r\n`));
  chunks.push(Buffer.from(`Content-Type: ${cleanMimeType}\r\n\r\n`));
  chunks.push(buffer);
  chunks.push(Buffer.from(`\r\n`));

  // Fim
  chunks.push(Buffer.from(`--${boundary}--\r\n`));

  const body = Buffer.concat(chunks);

  const res = await fetch(`https://graph.facebook.com/v23.0/${phoneNumberId}/media`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': `multipart/form-data; boundary=${boundary}`,
      'Content-Length': body.length.toString(),
    },
    body: body as any,
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`Falha ao subir mídia via Meta Cloud API: HTTP ${res.status} — ${JSON.stringify(data).slice(0, 300)}`);
  }
  return data.id;
}

/** Envia uma mensagem de mídia (imagem ou documento) já enviada via uploadWhatsAppMedia, por media_id. */
export async function sendWhatsAppMediaMessage(
  phoneNumberId: string | undefined,
  accessToken: string | undefined,
  to: string,
  mediaId: string,
  mimeType: string,
  caption?: string
): Promise<void> {
  if (!phoneNumberId || !accessToken) {
    throw new Error('META_PHONE_NUMBER_ID ou META_ACCESS_TOKEN ausentes — não é possível enviar mídia via Meta Cloud API.');
  }

  // Mensagem de áudio da Meta não aceita "caption" (diferente de imagem/documento).
  const type = mimeType.startsWith('image/') ? 'image' : mimeType.startsWith('audio/') ? 'audio' : 'document';
  const payload: any = { messaging_product: 'whatsapp', to, type };
  payload[type] = type === 'audio' ? { id: mediaId } : { id: mediaId, ...(caption ? { caption } : {}) };

  const res = await fetch(`https://graph.facebook.com/v23.0/${phoneNumberId}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    await throwMetaError(res, 'Falha ao enviar mídia via Meta Cloud API');
  }
}
