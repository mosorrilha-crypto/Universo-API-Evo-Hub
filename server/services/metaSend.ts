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
 * O FormData nativo do Node/Undici (usado pelo fetch global) foi testado e
 * serializa o Content-Type do Blob corretamente (confirmado inspecionando o
 * corpo multipart bruto produzido) — a causa real da rejeição da Meta não
 * era isso. Mantemos aqui a montagem manual do multipart só porque já
 * estava assim, não porque o FormData nativo tivesse um bug real.
 *
 * Contrato real da Meta pro campo "type" do multipart (confirmado por
 * documentação de terceiros que replicam o comportamento oficial): é o MIME
 * type completo do arquivo (ex: "audio/ogg; codecs=opus", "image/jpeg"), o
 * mesmo valor que já vai no Content-Type da parte "file" — nunca uma
 * categoria genérica ("audio"/"image"). Uma correção anterior (PR #138)
 * trocou isso pra categoria por engano, o que não bate com o contrato
 * documentado — revertido aqui.
 */
export async function uploadWhatsAppMedia(
  phoneNumberId: string | undefined,
  accessToken: string | undefined,
  mediaBuffer: Buffer,
  mimeType: string,
  filename: string
): Promise<string> {
  if (!phoneNumberId) throw new Error('META_PHONE_NUMBER_ID ausente — não é possível fazer upload de mídia.');
  if (!accessToken) throw new Error('META_ACCESS_TOKEN ausente — não é possível fazer upload de mídia.');
  if (!mediaBuffer || mediaBuffer.length === 0) throw new Error('Buffer da mídia ausente ou vazio.');
  if (!mimeType) throw new Error('MIME type da mídia ausente.');

  const cleanMimeType = mimeType.split(';')[0].trim();
  const boundary = `----WebKitFormBoundary${crypto.randomBytes(8).toString('hex')}`;

  const chunks: Buffer[] = [];

  // 1. messaging_product
  chunks.push(Buffer.from(`--${boundary}\r\n`));
  chunks.push(Buffer.from(`Content-Disposition: form-data; name="messaging_product"\r\n\r\n`));
  chunks.push(Buffer.from(`whatsapp\r\n`));

  // 2. type — MIME type completo (ex: "audio/ogg; codecs=opus"), igual ao
  // Content-Type da parte "file" abaixo — nunca uma categoria genérica.
  chunks.push(Buffer.from(`--${boundary}\r\n`));
  chunks.push(Buffer.from(`Content-Disposition: form-data; name="type"\r\n\r\n`));
  chunks.push(Buffer.from(`${mimeType}\r\n`));

  // 3. file — Content-Type aqui é o MIME type real (ex: "audio/ogg; codecs=opus")
  chunks.push(Buffer.from(`--${boundary}\r\n`));
  chunks.push(Buffer.from(`Content-Disposition: form-data; name="file"; filename="${filename}"\r\n`));
  chunks.push(Buffer.from(`Content-Type: ${cleanMimeType}\r\n\r\n`));
  chunks.push(mediaBuffer);
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
  if (!data.id) {
    throw new Error('Resposta da Meta não retornou um media_id válido após o upload.');
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
  if (!phoneNumberId) throw new Error('META_PHONE_NUMBER_ID ausente — não é possível enviar mensagem de mídia.');
  if (!accessToken) throw new Error('META_ACCESS_TOKEN ausente — não é possível enviar mensagem de mídia.');
  if (!to) throw new Error('Destinatário (to) ausente.');
  if (!mediaId) throw new Error('ID da mídia (mediaId) ausente.');

  // Mensagem de áudio da Meta não aceita "caption" (diferente de imagem/documento).
  // "voice: true" marca a mensagem como nota de voz de verdade (waveform/UI de
  // voice note no WhatsApp do destinatário) em vez de um "áudio básico" — sem
  // isso a Meta processa o arquivo com validação diferente.
  const type = mimeType.startsWith('image/') ? 'image' : mimeType.startsWith('audio/') ? 'audio' : 'document';
  const payload: any = {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to,
    type
  };
  payload[type] = type === 'audio' ? { id: mediaId, voice: true } : { id: mediaId, ...(caption ? { caption } : {}) };

  const res = await fetch(`https://graph.facebook.com/v23.0/${phoneNumberId}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    await throwMetaError(res, 'Falha ao enviar mídia via Meta Cloud API');
  }
}

/**
 * Fluxo completo de envio de áudio (Upload + Mensagem), conforme exigido pela Graph API.
 * Garante que o áudio seja materializado no provider antes de retornar sucesso.
 */
export async function sendWhatsAppAudioMessage(
  phoneNumberId: string | undefined,
  accessToken: string | undefined,
  to: string,
  audioBuffer: Buffer,
  mimeType: string
): Promise<string> {
  // 1. Validar parâmetros
  if (!phoneNumberId) throw new Error('phoneNumberId ausente');
  if (!accessToken) throw new Error('token ausente');
  if (!to) throw new Error('to ausente');
  if (!audioBuffer) throw new Error('audioBuffer ausente');
  if (!mimeType) throw new Error('mimeType ausente');

  // 2. Fazer upload do arquivo de áudio no endpoint de mídia
  const filename = 'voice-note.ogg';
  const mediaId = await uploadWhatsAppMedia(phoneNumberId, accessToken, audioBuffer, mimeType, filename);

  // 3. Enviar a mensagem final com type: "audio" e o media_id obtido
  await sendWhatsAppMediaMessage(phoneNumberId, accessToken, to, mediaId, mimeType);

  return mediaId;
}
