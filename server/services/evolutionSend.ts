/**
 * Epic 4.6 (Porta A — Evolution API, QR Code) — envio real de mensagem pra
 * fora, equivalente ao que `metaSend.ts` faz pra Meta Cloud API. Mesma
 * convenção de chamada já usada em `mediaDownload.ts` (downloadEvolutionMedia):
 * `{apiUrl}/{endpoint}/{instanceName}`, autenticado com header `apikey`.
 */

const REQUEST_TIMEOUT_MS = 15000;

function requireCredentials(instanceName: string | undefined, apiUrl: string | undefined, apiKey: string | undefined) {
  if (!instanceName || !apiUrl || !apiKey) {
    throw new Error('Instância/URL/API key da Evolution API ausentes — não é possível falar com essa instância.');
  }
}

/**
 * Envio de mensagem de texto via Evolution API (POST /message/sendText/{instance}).
 *
 * `quoted` (opcional) — mesmo objetivo do `replyToWamid` de metaSend.ts:
 * quando o operador responde a uma mensagem específica no painel, monta o
 * formato de citação que o Baileys/Evolution espera (`quoted.key` +
 * `quoted.message.conversation`), pra o WhatsApp do cliente mostrar "em
 * resposta a" de verdade em vez de só um metadado nosso. Retorna o id real
 * da mensagem enviada (`data.key.id`) — precisamos dele pra permitir citar
 * essa mesma mensagem numa resposta futura.
 */
export async function sendEvolutionTextMessage(
  instanceName: string | undefined,
  apiUrl: string | undefined,
  apiKey: string | undefined,
  to: string,
  text: string,
  quoted?: { id: string; remoteJid: string; fromMe: boolean; text?: string }
): Promise<string | undefined> {
  requireCredentials(instanceName, apiUrl, apiKey);

  const body: Record<string, unknown> = { number: to, text };
  if (quoted) {
    body.quoted = {
      key: { id: quoted.id, remoteJid: quoted.remoteJid, fromMe: quoted.fromMe },
      message: { conversation: quoted.text || '' },
    };
  }

  const res = await fetch(`${apiUrl!.replace(/\/$/, '')}/message/sendText/${instanceName}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: apiKey! },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  if (!res.ok) {
    const data = await res.json().catch(() => ({}) as any);
    throw new Error(`Falha ao enviar mensagem via Evolution API: HTTP ${res.status} — ${JSON.stringify(data).slice(0, 300)}`);
  }
  const data = await res.json().catch(() => ({}) as any);
  return data?.key?.id;
}

/** Envio de mídia (imagem, áudio, documento) via Evolution API (POST /message/sendMedia/{instance}). */
/**
 * Envia uma nota de voz PTT nativa. O endpoint dedicado é diferente de
 * `sendMedia`: este último sempre representa áudio como arquivo/mídia comum.
 */
export async function sendEvolutionVoiceMessage(
  instanceName: string | undefined,
  apiUrl: string | undefined,
  apiKey: string | undefined,
  to: string,
  base64: string,
  mimeType: string
): Promise<void> {
  requireCredentials(instanceName, apiUrl, apiKey);

  // Esta instância da Evolution reconhece Base64 puro. Ela rejeitou Data URL
  // tanto com quanto sem `codecs=opus` como mídia inválida (HTTP 400). A remoção
  // do cabeçalho preserva integralmente os bytes do contêiner OGG/Opus.
  const audio = base64.replace(/^data:[^,]*;base64,/i, '');
  const res = await fetch(`${apiUrl!.replace(/\/$/, '')}/message/sendWhatsAppAudio/${instanceName}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: apiKey! },
    body: JSON.stringify({
      number: to,
      audio,
      // Solicita à Evolution a codificação compatível com o PTT do WhatsApp.
      encoding: true,
      delay: 1200,
    }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`Falha ao enviar nota de voz via Evolution API: HTTP ${res.status} — ${JSON.stringify(data).slice(0, 300)}`);
  }
  console.log(`🎙️ [evolutionVoiceNote] to=***${to.replace(/\D/g, '').slice(-4)} mime="${mimeType}" message_id=${(data as any)?.key?.id || 'não informado'}`);
}

/** Envio de mídia (imagem, áudio, documento) via Evolution API (POST /message/sendMedia/{instance}). */
export async function sendEvolutionMediaMessage(
  instanceName: string | undefined,
  apiUrl: string | undefined,
  apiKey: string | undefined,
  to: string,
  base64: string,
  mimeType: string,
  filename: string,
  caption?: string
): Promise<void> {
  requireCredentials(instanceName, apiUrl, apiKey);

  const isAudio = mimeType.startsWith('audio/');
  const mediatype = isAudio ? 'audio' : mimeType.startsWith('image/') ? 'image' : mimeType.startsWith('video/') ? 'video' : 'document';
  // Achado real (27/08/2026): `exampleImageBase64` do catálogo é salvo como
  // data URI completa ("data:image/png;base64,...", vindo direto do upload
  // no navegador) e um chamador (runMidiaTool em autoReply.ts) mandava esse
  // valor sem tirar o prefixo — a Evolution API rejeita com "Owned media
  // must be a url or base64", derrubando silenciosamente o envio da foto de
  // exemplo pro cliente. Limpa aqui, na função de envio, pra proteger todo
  // chamador de uma vez (mesmo padrão de limpeza já usado nos outros
  // pontos que montam esse payload manualmente).
  const cleanBase64 = base64.replace(/^data:[^;]+;base64,/, '');

  const res = await fetch(`${apiUrl!.replace(/\/$/, '')}/message/sendMedia/${instanceName}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: apiKey! },
    body: JSON.stringify({
      number: to,
      media: cleanBase64,
      mediatype,
      mimetype: mimeType,
      caption: isAudio ? undefined : caption,
      fileName: filename,
      delay: 1200,
      isAudio: isAudio, // Essencial para que o áudio chegue como nota de voz (ícone de microfone)
    }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  if (!res.ok) {
    const data = await res.json().catch(() => ({}) as any);
    throw new Error(`Falha ao enviar mídia via Evolution API: HTTP ${res.status} — ${JSON.stringify(data).slice(0, 300)}`);
  }
}

/**
 * Postagem de Status/Stories via Evolution API (POST /message/sendStatus/{instance})
 * — só existe pra instâncias Evolution (Baileys/não-oficial); a Meta Cloud
 * API oficial não expõe Status nenhum. Pedido real do dono do produto,
 * 12/08/2026: fotos de "antes/depois" de procedimento no Status já aquecem
 * lead comprovadamente, mas isso hoje só é postado manualmente fora do
 * produto. `allContacts: true` sempre — não faz sentido no nosso caso
 * escolher destinatários específicos, é uma vitrine pra toda a lista.
 */
export async function sendEvolutionStatus(
  instanceName: string | undefined,
  apiUrl: string | undefined,
  apiKey: string | undefined,
  status:
    | { type: 'text'; content: string; backgroundColor?: string; font?: number }
    | { type: 'image'; content: string; caption?: string }
    | { type: 'video'; content: string; caption?: string }
): Promise<void> {
  requireCredentials(instanceName, apiUrl, apiKey);

  const res = await fetch(`${apiUrl!.replace(/\/$/, '')}/message/sendStatus/${instanceName}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: apiKey! },
    body: JSON.stringify({ ...status, allContacts: true }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  if (!res.ok) {
    const data = await res.json().catch(() => ({}) as any);
    throw new Error(`Falha ao postar Status via Evolution API: HTTP ${res.status} — ${JSON.stringify(data).slice(0, 300)}`);
  }
}

/**
 * Indicador "digitando..." via Evolution API (POST /chat/sendPresence/{instance}).
 * Mesmo espírito de `markAsReadAndShowTyping` (metaSend.ts): melhor esforço,
 * nunca deve travar o envio real da resposta se falhar.
 */
export async function showEvolutionTyping(
  instanceName: string | undefined,
  apiUrl: string | undefined,
  apiKey: string | undefined
): Promise<void> {
  if (!instanceName || !apiUrl || !apiKey) return;
  try {
    await fetch(`${apiUrl.replace(/\/$/, '')}/chat/sendPresence/${instanceName}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: apiKey },
      body: JSON.stringify({ presence: 'composing', delay: 1200 }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (err) {
    console.warn('⚠️  Falha ao mostrar indicador de digitação (Evolution):', (err as Error).message);
  }
}

/**
 * Registra o webhook da instância pra apontar de volta pro nosso backend
 * (POST /webhook/set/{instance}) — bug real em produção (12/08/2026): o
 * onboarding via QR Code (admin.ts, POST .../evolution-instance) criava a
 * instância normalmente, mas nunca configurava o webhook dela. A instância
 * recebia a mensagem certinho (por isso aparecia no WhatsApp Business do
 * celular, sincronizado direto pela Meta), mas nunca avisava o Universo —
 * o agente nunca via nada chegar. Chamado tanto na criação quanto sempre
 * que o QR é (re)gerado, pra também corrigir instâncias já criadas antes
 * desta correção sem precisar desconectar/reconectar o número.
 */
export async function setEvolutionWebhook(
  instanceName: string | undefined,
  apiUrl: string | undefined,
  apiKey: string | undefined,
  webhookUrl: string
): Promise<void> {
  requireCredentials(instanceName, apiUrl, apiKey);

  const res = await fetch(`${apiUrl!.replace(/\/$/, '')}/webhook/set/${instanceName}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: apiKey! },
    body: JSON.stringify({
      webhook: {
        enabled: true,
        url: webhookUrl,
        events: ['MESSAGES_UPSERT'],
      },
    }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  if (!res.ok) {
    const data = await res.json().catch(() => ({}) as any);
    throw new Error(`Falha ao configurar o webhook da instância Evolution API: HTTP ${res.status} — ${JSON.stringify(data).slice(0, 300)}`);
  }
}
