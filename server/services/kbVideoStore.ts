/**
 * Vídeo de exemplo de produto (Base de Conhecimento) — arquivo grande demais
 * pra inline base64 na jsonb da knowledge_base (diferente da foto de
 * exemplo, ver knowledgeBaseStore.ts). O produto guarda só a referência
 * (exampleVideoId); o arquivo em si fica no mesmo bucket privado "app-data"
 * usado pra mídia recebida (mediaImageStore.ts), sob o prefixo
 * "kb-video/{tenantId}/{videoId}" pra nunca colidir com "media/{messageId}".
 */
const BUCKET = 'app-data';

export async function getKbVideo(
  supabaseUrl: string | undefined,
  supabaseKey: string | undefined,
  tenantId: string,
  videoId: string
): Promise<{ buffer: Buffer; contentType: string } | null> {
  if (!supabaseUrl || !supabaseKey) return null;
  const res = await fetch(
    `${supabaseUrl}/storage/v1/object/${BUCKET}/kb-video/${encodeURIComponent(tenantId)}/${encodeURIComponent(videoId)}`,
    { headers: { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}` } }
  );
  if (!res.ok) return null;
  const buffer = Buffer.from(await res.arrayBuffer());
  const contentType = res.headers.get('content-type') || 'video/mp4';
  return { buffer, contentType };
}
