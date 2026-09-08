/**
 * TASK-0218 — migração das fotos de exemplo/antes-depois/primeiro-contato da
 * Base de Conhecimento, hoje inline em Base64 dentro do JSON (achado real:
 * TASK-0074/0075, a tabela `knowledge_base` da Monique sozinha chegou a
 * ~12MB, quase tudo foto, e foi a causa raiz confirmada do estouro de egress
 * do plano Free do Supabase). Sob o prefixo kb-image/{tenantId}/{imageId} —
 * nunca público, autenticado por rota. Deliberadamente o MESMO desenho já
 * usado por vídeo: upload/get/delete, SEM tabela de metadados separada —
 * mimeType/fileName/sizeBytes ficam inline no próprio JSON da KB ao lado do
 * id (ex: exampleImageId + exampleImageMimeType + ...), pelo mesmo motivo já
 * valendo pra vídeo: metadado é pequeno, só o binário precisava sair do JSON.
 *
 * TASK-0332 (achado real, 07/09/2026): o MESMO tipo de estouro de egress
 * voltou a acontecer — desta vez não mais no JSON, mas no próprio bucket
 * "app-data" do Supabase Storage (fotos de exemplo do catálogo, ~91% do
 * egress do ciclo de faturamento). Migrado pra Cloudflare R2 (S3-compatível,
 * sem cobrança de egress) via objectStorage.ts — mesma assinatura exportada
 * (inclusive `supabaseUrl`/`supabaseKey`, agora ignorados) pra não tocar nos
 * ~45 pontos de chamada. Pedido direto do dono do produto: sem migração do
 * conteúdo já existente no Supabase — as fotos são reenviadas manualmente.
 *
 * Desacoplado de qual produto/bloco usa a imagem: o upload só grava o
 * binário e devolve um imageId; é o cliente (AgentKnowledgeBase.tsx) que
 * associa esse id no formData local — só persiste de fato quando "Salvar
 * Regras no Agente"/publicar salva a base inteira.
 */
import { logStructured } from './structuredLog';
import { getObjectStorageConfig, putObject, getObject, deleteObject } from './objectStorage';
import { getLegacySupabaseStorageObject } from './legacySupabaseStorage';

/** JPEG/PNG/WebP — os três formatos que a Meta Cloud API aceita direto pra mensagem de imagem do WhatsApp, sem conversão nenhuma (diferente de vídeo, que às vezes precisa de transcode). */
export const ALLOWED_IMAGE_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

/** Limite real da Meta Cloud API pra mídia de imagem (5MB). */
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

function storagePath(tenantId: string, imageId: string): string {
  return `kb-image/${encodeURIComponent(tenantId)}/${encodeURIComponent(imageId)}`;
}

export async function uploadKnowledgeBaseImage(
  _supabaseUrl: string | undefined,
  _supabaseKey: string | undefined,
  tenantId: string,
  imageId: string,
  buffer: Buffer,
  mimeType: string
): Promise<void> {
  const config = getObjectStorageConfig();
  if (!config) throw new Error('Storage não configurado (R2_ACCOUNT_ID/R2_ACCESS_KEY_ID/R2_SECRET_ACCESS_KEY/R2_BUCKET_NAME ausentes).');
  await putObject(config, storagePath(tenantId, imageId), buffer, mimeType || 'application/octet-stream');
}

export async function getKnowledgeBaseImage(
  supabaseUrl: string | undefined,
  supabaseKey: string | undefined,
  tenantId: string,
  imageId: string
): Promise<{ buffer: Buffer; contentType: string } | null> {
  const config = getObjectStorageConfig();
  const result = config ? await getObject(config, storagePath(tenantId, imageId)) : null;
  const legacy = result ? null : await getLegacySupabaseStorageObject(supabaseUrl, supabaseKey, storagePath(tenantId, imageId));
  const found = result || legacy;
  if (!found) return null;
  return { buffer: found.buffer, contentType: found.contentType || 'image/jpeg' };
}

/**
 * Resolve o binário real de uma imagem da KB, com o mesmo contrato de
 * compatibilidade pedido pra migração inteira:
 *   se existir imageId: usa a mídia no Storage
 *   senão, se existir base64 legado: usa o base64 e registra observabilidade
 *   senão: considera a imagem ausente
 * `imageId` presente mas não encontrado no Storage é tratado como ausente
 * (nunca cai pro base64 legado — os dois não deveriam coexistir de verdade;
 * se `imageId` foi definido, é porque já foi migrado). Usado pelos 3 pontos
 * que enviam a foto de verdade por WhatsApp (runMidiaTool em autoReply.ts,
 * firstContactMessage.ts, e o envio manual em conversations.ts), pra não
 * triplicar essa lógica de fallback.
 */
export async function resolveKnowledgeBaseImageBinary(
  supabaseUrl: string | undefined,
  supabaseKey: string | undefined,
  tenantId: string,
  imageId: string | undefined,
  mimeType: string | undefined,
  legacyBase64: string | undefined,
  logOp: string
): Promise<{ buffer: Buffer; mimeType: string } | null> {
  if (imageId) {
    const image = await getKnowledgeBaseImage(supabaseUrl, supabaseKey, tenantId, imageId);
    if (!image) return null;
    return { buffer: image.buffer, mimeType: mimeType || image.contentType };
  }
  if (legacyBase64) {
    // Achado real (TASK-0074/0075): o próprio uso deste fallback é o sinal
    // de que ainda existe conteúdo não migrado — sem observabilidade, não
    // dava pra saber quando a migração pode ser considerada concluída pra
    // um tenant. Não é erro (a leitura funciona normalmente), por isso
    // outcome 'success' — só um marcador rastreável de "ainda legado".
    logStructured({ tenantId, area: 'knowledgeBase', op: logOp, outcome: 'success', detail: 'source=legacy_base64_fallback' });
    return { buffer: Buffer.from(legacyBase64.replace(/^data:[^;]+;base64,/, ''), 'base64'), mimeType: mimeType || 'image/jpeg' };
  }
  return null;
}

/** Melhor esforço: chamado ao trocar a imagem de um produto/bloco por outra, pra não acumular lixo no Storage a cada troca. Nunca deve travar o upload novo se falhar. */
export async function deleteKnowledgeBaseImage(
  _supabaseUrl: string | undefined,
  _supabaseKey: string | undefined,
  tenantId: string,
  imageId: string
): Promise<void> {
  const config = getObjectStorageConfig();
  if (!config) return;
  try {
    await deleteObject(config, storagePath(tenantId, imageId));
  } catch (err: any) {
    console.warn(`⚠️  [KB Imagem] Falha ao apagar imagem antiga do Storage (tenant=${tenantId}, image=${imageId}):`, err.message);
  }
}
