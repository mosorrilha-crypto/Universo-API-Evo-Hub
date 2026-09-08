/**
 * TASK-0332 (achado real, 07/09/2026, pós-merge): fallback de LEITURA para
 * mídia enviada ANTES da migração pro Cloudflare R2. O dono do produto
 * autorizou não migrar o conteúdo já existente no bucket privado "app-data"
 * do Supabase Storage (fotos de catálogo são reenviadas manualmente) — mas
 * isso não cobre mídia de CONVERSA já trocada com clientes (fotos,
 * comprovantes de pagamento): esse conteúdo já aconteceu, não dá pra
 * "reenviar". Sem este fallback, ficaria permanentemente inacessível assim
 * que o app passasse a procurar só no R2.
 *
 * Escrita nunca usa isso — upload novo vai só pro R2 (objectStorage.ts).
 * Puramente leitura, melhor esforço: qualquer falha (config ausente, URL
 * inválida, 404, erro de rede) retorna null, nunca lança.
 */
export async function getLegacySupabaseStorageObject(
  supabaseUrl: string | undefined,
  supabaseKey: string | undefined,
  path: string
): Promise<{ buffer: Buffer; contentType: string } | null> {
  if (!supabaseUrl || !supabaseKey) return null;
  let protocol: string;
  try {
    protocol = new URL(supabaseUrl).protocol;
  } catch {
    return null;
  }
  if (protocol !== 'http:' && protocol !== 'https:') return null;

  try {
    const res = await fetch(`${supabaseUrl}/storage/v1/object/app-data/${path}`, {
      headers: { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}` },
    });
    if (!res.ok) return null;
    const buffer = Buffer.from(await res.arrayBuffer());
    const contentType = res.headers.get('content-type') || 'application/octet-stream';
    return { buffer, contentType };
  } catch {
    return null;
  }
}
