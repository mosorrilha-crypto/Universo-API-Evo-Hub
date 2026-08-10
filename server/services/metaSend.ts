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
 * Upload de mídia (foto/documento escolhido no painel, ou nota de voz
 * gravada) antes de poder referenciá-la numa mensagem — mesmo padrão do
 * whatsapp-agent-monique (lib/whatsapp.js: uploadMedia). Retorna o media_id
 * da Meta.
 *
 * Achado real em produção: o erro 131053 ("Audio file uploaded with
 * mimetype as audio/ogg; codecs=opus, however on processing it is of type
 * application/octet-stream") persistiu de forma IDÊNTICA através de várias
 * rodadas de correção que já descartaram: (a) conteúdo do arquivo — o
 * ffmpeg gera um Ogg/Opus genuinamente válido, confirmado com "file"
 * (libmagic) reconhecendo corretamente "Ogg data, Opus audio, ... 16000 Hz";
 * (b) montagem do multipart — testado tanto à mão quanto com FormData/Blob
 * nativos do Node, resultado idêntico. O que sobra: a lista de tipos de
 * áudio documentados pela Meta usa o valor literal "audio/ogg" (sem
 * parâmetro de codec) — só o texto da doc esclarece "codecs=opus" como
 * requisito do CONTAINER, não como parte do MIME type a enviar. Todas as
 * tentativas anteriores mandaram "; codecs=opus" em pelo menos um dos dois
 * lugares (campo "type" do multipart e/ou Content-Type da parte "file").
 * Aqui os dois usam o MIME type base, sem parâmetro — combinação ainda não
 * testada nas rodadas anteriores.
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
  const form = new FormData();
  form.append('messaging_product', 'whatsapp');
  form.append('type', cleanMimeType);
  form.append('file', new Blob([mediaBuffer], { type: cleanMimeType }), filename);

  const res = await fetch(`https://graph.facebook.com/v23.0/${phoneNumberId}/media`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}` },
    body: form,
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`Falha ao subir mídia via Meta Cloud API: HTTP ${res.status} — ${JSON.stringify(data).slice(0, 300)}`);
  }
  if (!data.id) {
    throw new Error('Resposta da Meta não retornou um media_id válido após o upload.');
  }

  // Diagnóstico temporário (erro 131053 "however on processing it is of
  // type application/octet-stream" persistiu de forma idêntica através de
  // 3 rodadas de correção de multipart/mimetype — inclusive o próprio
  // texto do erro nunca mudou mesmo quando o mimeType enviado mudou, sinal
  // de que é uma mensagem fixa/genérica e não reflete o que enviamos de
  // verdade). Em vez de continuar adivinhando, consulta a Meta o que ela
  // efetivamente registrou pro media_id — mime_type, tamanho e sha256 —
  // pra comparar com o que geramos localmente e descobrir se a divergência
  // (se houver) já existe logo após o upload, ou só aparece depois.
  if (mimeType.startsWith('audio/')) {
    try {
      const infoRes = await fetch(`https://graph.facebook.com/v23.0/${data.id}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const info = await infoRes.json().catch(() => ({}) as any);
      const localSha256 = crypto.createHash('sha256').update(mediaBuffer).digest('hex');
      console.log(
        `🔎 [uploadWhatsAppMedia] media_id=${data.id} — Meta: mime_type="${info?.mime_type}" file_size=${info?.file_size} sha256=${info?.sha256} | local: size=${mediaBuffer.length} sha256=${localSha256} sha256_bate=${info?.sha256 === localSha256}`
      );
    } catch (err) {
      console.warn('⚠️  [uploadWhatsAppMedia] Falha ao consultar diagnóstico do media_id na Meta:', (err as Error).message);
    }
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
