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

/** Envio de mensagem de texto via Evolution API (POST /message/sendText/{instance}). */
export async function sendEvolutionTextMessage(
  instanceName: string | undefined,
  apiUrl: string | undefined,
  apiKey: string | undefined,
  to: string,
  text: string
): Promise<void> {
  requireCredentials(instanceName, apiUrl, apiKey);

  const res = await fetch(`${apiUrl!.replace(/\/$/, '')}/message/sendText/${instanceName}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: apiKey! },
    body: JSON.stringify({ number: to, text }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  if (!res.ok) {
    const data = await res.json().catch(() => ({}) as any);
    throw new Error(`Falha ao enviar mensagem via Evolution API: HTTP ${res.status} — ${JSON.stringify(data).slice(0, 300)}`);
  }
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
  const mediatype = isAudio ? 'audio' : mimeType.startsWith('image/') ? 'image' : 'document';

  const res = await fetch(`${apiUrl!.replace(/\/$/, '')}/message/sendMedia/${instanceName}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: apiKey! },
    body: JSON.stringify({
      number: to,
      media: base64,
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
  status: { type: 'text'; content: string; backgroundColor?: string; font?: number } | { type: 'image'; content: string; caption?: string }
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
