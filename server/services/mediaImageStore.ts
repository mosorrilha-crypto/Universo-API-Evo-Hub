/**
 * Guarda imagens que o CLIENTE manda pelo WhatsApp (ex: comprovante de
 * pagamento, foto de referência) — sem isso, a imagem vira só um texto
 * genérico "📷 Imagem recebida" e o conteúdo real se perde. Mesmo conceito
 * do saveMediaImage/getMediaImage do whatsapp-agent-monique.
 *
 * Guardado no bucket privado "app-data" (mesmo das conversas/KB), indexado
 * pelo message_id da Meta — só acessível via rota autenticada
 * (GET /api/media/:messageId em server/routes/conversations.ts), nunca
 * público, já que pode conter dados sensíveis (ex: número de conta bancária
 * num comprovante).
 */
const BUCKET = 'app-data';

export async function saveMediaImage(
  supabaseUrl: string | undefined,
  supabaseKey: string | undefined,
  messageId: string,
  base64: string,
  mimeType: string
): Promise<void> {
  if (!supabaseUrl || !supabaseKey) return;
  const cleanBase64 = base64.replace(/^data:[^;]+;base64,/, '');
  const buffer = Buffer.from(cleanBase64, 'base64');

  await fetch(`${supabaseUrl}/storage/v1/object/${BUCKET}/media/${encodeURIComponent(messageId)}`, {
    method: 'POST',
    headers: {
      apikey: supabaseKey,
      Authorization: `Bearer ${supabaseKey}`,
      'Content-Type': mimeType,
      'x-upsert': 'true',
    },
    body: buffer as any,
  }).catch((err) => console.warn('⚠️  [Mídia] Falha ao salvar imagem recebida:', err.message));
}

export async function getMediaImage(
  supabaseUrl: string | undefined,
  supabaseKey: string | undefined,
  messageId: string
): Promise<{ buffer: Buffer; contentType: string } | null> {
  if (!supabaseUrl || !supabaseKey) return null;
  const res = await fetch(`${supabaseUrl}/storage/v1/object/${BUCKET}/media/${encodeURIComponent(messageId)}`, {
    headers: { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}` },
  });
  if (!res.ok) return null;
  const buffer = Buffer.from(await res.arrayBuffer());
  const contentType = res.headers.get('content-type') || 'image/jpeg';
  return { buffer, contentType };
}
