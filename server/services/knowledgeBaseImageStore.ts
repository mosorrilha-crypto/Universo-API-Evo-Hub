/**
 * TASK-0218 — migração das fotos de exemplo/antes-depois/primeiro-contato da
 * Base de Conhecimento, hoje inline em Base64 dentro do JSON (achado real:
 * TASK-0074/0075, a tabela `knowledge_base` da Monique sozinha chegou a
 * ~12MB, quase tudo foto, e foi a causa raiz confirmada do estouro de egress
 * do plano Free do Supabase). Mesmo bucket privado "app-data" já usado por
 * knowledgeBaseVideoStore.ts/mediaImageStore.ts/knowledgeBaseDocumentStore.ts,
 * sob o prefixo kb-image/{tenantId}/{imageId} — nunca público, autenticado
 * por rota. Deliberadamente o MESMO desenho já usado por vídeo: upload/get/
 * delete via fetch cru na REST API do Storage, SEM tabela de metadados
 * separada — mimeType/fileName/sizeBytes ficam inline no próprio JSON da KB
 * ao lado do id (ex: exampleImageId + exampleImageMimeType + ...), pelo
 * mesmo motivo já valendo pra vídeo: metadado é pequeno, só o binário
 * precisava sair do JSON.
 *
 * Desacoplado de qual produto/bloco usa a imagem: o upload só grava o
 * binário e devolve um imageId; é o cliente (AgentKnowledgeBase.tsx) que
 * associa esse id no formData local — só persiste de fato quando "Salvar
 * Regras no Agente"/publicar salva a base inteira.
 */
const BUCKET = 'app-data';

/** JPEG/PNG/WebP — os três formatos que a Meta Cloud API aceita direto pra mensagem de imagem do WhatsApp, sem conversão nenhuma (diferente de vídeo, que às vezes precisa de transcode). */
export const ALLOWED_IMAGE_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

/** Limite real da Meta Cloud API pra mídia de imagem (5MB). */
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

function storagePath(tenantId: string, imageId: string): string {
  return `kb-image/${encodeURIComponent(tenantId)}/${encodeURIComponent(imageId)}`;
}

/** Mesma checagem estrutural (URL bem-formada, protocolo http/https) já usada em knowledgeBaseVideoStore.ts/evolutionSend.ts/mediaImageStore.ts (TASK-0197/0200) — evita mandar dado binário pra uma URL não validada. */
function assertValidHttpUrl(url: string): void {
  let protocol: string;
  try {
    protocol = new URL(url).protocol;
  } catch {
    throw new Error(`URL do Storage inválida: "${url}".`);
  }
  if (protocol !== 'http:' && protocol !== 'https:') {
    throw new Error(`Protocolo não permitido para o Storage: "${protocol}".`);
  }
}

export async function uploadKnowledgeBaseImage(
  supabaseUrl: string | undefined,
  supabaseKey: string | undefined,
  tenantId: string,
  imageId: string,
  buffer: Buffer,
  mimeType: string
): Promise<void> {
  if (!supabaseUrl || !supabaseKey) throw new Error('Storage não configurado (SUPABASE_URL/SUPABASE_KEY ausentes).');
  assertValidHttpUrl(supabaseUrl);
  const res = await fetch(`${supabaseUrl}/storage/v1/object/${BUCKET}/${storagePath(tenantId, imageId)}`, {
    method: 'POST',
    headers: {
      apikey: supabaseKey,
      Authorization: `Bearer ${supabaseKey}`,
      'Content-Type': mimeType || 'application/octet-stream',
      'x-upsert': 'true',
    },
    body: buffer as any,
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Falha ao enviar imagem pro Storage: HTTP ${res.status} — ${body.slice(0, 300)}`);
  }
}

export async function getKnowledgeBaseImage(
  supabaseUrl: string | undefined,
  supabaseKey: string | undefined,
  tenantId: string,
  imageId: string
): Promise<{ buffer: Buffer; contentType: string } | null> {
  if (!supabaseUrl || !supabaseKey) return null;
  assertValidHttpUrl(supabaseUrl);
  const res = await fetch(`${supabaseUrl}/storage/v1/object/${BUCKET}/${storagePath(tenantId, imageId)}`, {
    headers: { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}` },
  });
  if (!res.ok) return null;
  const buffer = Buffer.from(await res.arrayBuffer());
  const contentType = res.headers.get('content-type') || 'image/jpeg';
  return { buffer, contentType };
}

/** Melhor esforço: chamado ao trocar a imagem de um produto/bloco por outra, pra não acumular lixo no Storage a cada troca. Nunca deve travar o upload novo se falhar. */
export async function deleteKnowledgeBaseImage(
  supabaseUrl: string | undefined,
  supabaseKey: string | undefined,
  tenantId: string,
  imageId: string
): Promise<void> {
  if (!supabaseUrl || !supabaseKey) return;
  try {
    assertValidHttpUrl(supabaseUrl);
    const res = await fetch(`${supabaseUrl}/storage/v1/object/${BUCKET}/${storagePath(tenantId, imageId)}`, {
      method: 'DELETE',
      headers: { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}` },
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      console.warn(`⚠️  [KB Imagem] Falha ao apagar imagem antiga do Storage (tenant=${tenantId}, image=${imageId}): HTTP ${res.status} — ${body.slice(0, 300)}`);
    }
  } catch (err: any) {
    console.warn(`⚠️  [KB Imagem] Falha ao apagar imagem antiga do Storage (tenant=${tenantId}, image=${imageId}):`, err.message);
  }
}
