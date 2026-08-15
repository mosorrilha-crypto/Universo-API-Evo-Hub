/**
 * Instagram DM (Fase 1, 15/08/2026) — envio real de mensagem pra fora,
 * equivalente ao que `metaSend.ts`/`evolutionSend.ts` fazem pros outros dois
 * provedores. Instagram Messaging API é parte da mesma família "Messenger
 * Platform" da Meta — envio via Graph API, `POST /{instagram-account-id}/messages`
 * com o access token da conta/página. Referência:
 * https://developers.facebook.com/docs/messenger-platform/instagram/send-messages
 */

const REQUEST_TIMEOUT_MS = 15000;
const GRAPH_API_VERSION = 'v23.0';

/** Envio de mensagem de texto via Instagram Messaging API. */
export async function sendInstagramTextMessage(
  instagramAccountId: string | undefined,
  accessToken: string | undefined,
  to: string,
  text: string
): Promise<void> {
  if (!instagramAccountId || !accessToken) {
    throw new Error('ID da conta Instagram ou access token ausentes — não é possível enviar mensagem via Instagram.');
  }

  const res = await fetch(`https://graph.facebook.com/${GRAPH_API_VERSION}/${instagramAccountId}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ recipient: { id: to }, message: { text } }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  if (!res.ok) {
    const data = await res.json().catch(() => ({}) as any);
    throw new Error(`Falha ao enviar mensagem via Instagram: HTTP ${res.status} — ${JSON.stringify(data).slice(0, 300)}`);
  }
}

/**
 * Indicador "digitando..." via `sender_action: typing_on` — mesmo espírito
 * de `markAsReadAndShowTyping`/`showEvolutionTyping`: melhor esforço, nunca
 * deve travar o envio real da resposta se falhar.
 */
export async function showInstagramTyping(
  instagramAccountId: string | undefined,
  accessToken: string | undefined,
  to: string | undefined
): Promise<void> {
  if (!instagramAccountId || !accessToken || !to) return;
  try {
    await fetch(`https://graph.facebook.com/${GRAPH_API_VERSION}/${instagramAccountId}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ recipient: { id: to }, sender_action: 'typing_on' }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (err) {
    console.warn('⚠️  Falha ao mostrar indicador de digitação (Instagram):', (err as Error).message);
  }
}
