/**
 * Upload real de vídeo de exemplo de produto/serviço pra base de
 * conhecimento — pedido real do dono do produto: o agente (ou o operador
 * manualmente) mandar um vídeo de verdade pro lead, geralmente de até ~1
 * minuto, além da foto que já existia (Epic 4.5.2). Sob o prefixo
 * kb-video/{tenantId}/{videoId} — nunca público, autenticado por rota.
 *
 * TASK-0332 (achado real, 07/09/2026): migrado pra Cloudflare R2 junto com
 * knowledgeBaseImageStore.ts/mediaImageStore.ts/knowledgeBaseDocumentStore.ts
 * — mesmo motivo (egress do Supabase Storage estourando a cota do plano
 * Free). Ver comentário completo em knowledgeBaseImageStore.ts.
 *
 * Desacoplado de qual produto usa o vídeo (ver rotas em conversations.ts): o
 * upload só grava o binário e devolve um videoId; é o cliente
 * (AgentKnowledgeBase.tsx) que associa esse id a um produto no formData
 * local, exatamente como já funciona pra foto (exampleImageBase64) — só
 * persiste de fato quando "Salvar Regras no Agente" salva a base inteira.
 * Sem essa separação, o upload exigiria que o produto já existisse salvo no
 * servidor antes de poder anexar um vídeo, quebrando o fluxo normal de
 * criar um produto novo e já anexar o vídeo numa passada só.
 */
import { getObjectStorageConfig, putObject, getObject, deleteObject } from './objectStorage';

/**
 * Formatos que a Meta Cloud API aceita DIRETO pra mensagem de vídeo do
 * WhatsApp (MP4/3GPP, H.264+AAC). Qualquer outro formato de vídeo (ex: .MOV
 * do iPhone, "video/quicktime") passa primeiro por videoTranscode.ts antes
 * de chegar até aqui — ver POST /api/knowledge-base/videos em
 * conversations.ts.
 */
export const ALLOWED_VIDEO_MIME_TYPES = new Set(['video/mp4', 'video/3gpp']);

/** Limite real da Meta Cloud API pra mídia de vídeo (16MB) — checado no arquivo FINAL (já convertido, se precisou). Um vídeo de ~1 minuto bem comprimido fica bem abaixo disso. */
export const MAX_VIDEO_BYTES = 16 * 1024 * 1024;

/**
 * Teto do arquivo ORIGINAL antes de qualquer conversão — bem mais folgado
 * que MAX_VIDEO_BYTES porque um .MOV de iPhone sem compressão de verdade
 * (o cenário mais comum que passa por aqui) é bem maior que o MP4 final.
 * Limitado pelo próprio corpo da requisição (express.json, 50MB em
 * server.ts) — em base64 (~33% maior que o binário), 35MB de vídeo bruto
 * viram ~47MB de JSON, com folga pros outros campos do payload.
 */
export const MAX_VIDEO_INPUT_BYTES = 35 * 1024 * 1024;

function storagePath(tenantId: string, videoId: string): string {
  return `kb-video/${encodeURIComponent(tenantId)}/${encodeURIComponent(videoId)}`;
}

export async function uploadKnowledgeBaseVideo(
  _supabaseUrl: string | undefined,
  _supabaseKey: string | undefined,
  tenantId: string,
  videoId: string,
  buffer: Buffer,
  mimeType: string
): Promise<void> {
  const config = getObjectStorageConfig();
  if (!config) throw new Error('Storage não configurado (R2_ACCOUNT_ID/R2_ACCESS_KEY_ID/R2_SECRET_ACCESS_KEY/R2_BUCKET_NAME ausentes).');
  await putObject(config, storagePath(tenantId, videoId), buffer, mimeType || 'application/octet-stream');
}

export async function getKnowledgeBaseVideo(
  _supabaseUrl: string | undefined,
  _supabaseKey: string | undefined,
  tenantId: string,
  videoId: string
): Promise<{ buffer: Buffer; contentType: string } | null> {
  const config = getObjectStorageConfig();
  if (!config) return null;
  const result = await getObject(config, storagePath(tenantId, videoId));
  if (!result) return null;
  return { buffer: result.buffer, contentType: result.contentType || 'video/mp4' };
}

/** Melhor esforço: chamado ao trocar o vídeo de um produto por outro, pra não acumular lixo no Storage a cada troca. Nunca deve travar o upload novo se falhar. */
export async function deleteKnowledgeBaseVideo(
  _supabaseUrl: string | undefined,
  _supabaseKey: string | undefined,
  tenantId: string,
  videoId: string
): Promise<void> {
  const config = getObjectStorageConfig();
  if (!config) return;
  try {
    await deleteObject(config, storagePath(tenantId, videoId));
  } catch (err: any) {
    console.warn(`⚠️  [KB Vídeo] Falha ao apagar vídeo antigo do Storage (tenant=${tenantId}, video=${videoId}):`, err.message);
  }
}
