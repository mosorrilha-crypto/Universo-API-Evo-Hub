/**
 * Guarda imagens que o CLIENTE manda pelo WhatsApp (ex: comprovante de
 * pagamento, foto de referência) — sem isso, a imagem vira só um texto
 * genérico "📷 Imagem recebida" e o conteúdo real se perde. Mesmo conceito
 * do saveMediaImage/getMediaImage do whatsapp-agent-monique.
 *
 * Indexado pelo message_id da Meta — só acessível via rota autenticada
 * (GET /api/media/:messageId em server/routes/conversations.ts), nunca
 * público, já que pode conter dados sensíveis (ex: número de conta bancária
 * num comprovante).
 *
 * TASK-0332 (achado real, 07/09/2026): esta é a maior fonte de egress real
 * de produção (mídia de conversa é reaberta/rebaixada toda vez que o
 * operador abre o chat) — migrado pra Cloudflare R2 junto com
 * knowledgeBaseImageStore.ts/knowledgeBaseVideoStore.ts/knowledgeBaseDocumentStore.ts.
 * Ver comentário completo em knowledgeBaseImageStore.ts.
 */
import { getObjectStorageConfig, putObject, getObject } from './objectStorage';
import { getLegacySupabaseStorageObject } from './legacySupabaseStorage';

function storagePath(messageId: string): string {
  return `media/${encodeURIComponent(messageId)}`;
}

export async function saveMediaImage(
  _supabaseUrl: string | undefined,
  _supabaseKey: string | undefined,
  messageId: string,
  base64: string,
  mimeType: string
): Promise<void> {
  const config = getObjectStorageConfig();
  // Achado real em produção (11/09/2026): esta checagem era um retorno
  // 100% silencioso — sem R2_ACCOUNT_ID/R2_ACCESS_KEY_ID/R2_SECRET_ACCESS_KEY/
  // R2_BUCKET_NAME configurados (as 4 env vars da TASK-0332), TODA mídia de
  // WhatsApp (imagem/áudio, recebida ou enviada) parava de ser salva sem
  // NENHUM log de erro em lugar nenhum — o mesmo padrão de "falha silenciosa"
  // que a auditoria externa citada abaixo já tinha corrigido pro caso de
  // `putObject` lançar, mas não pro caso de config ausente. GET /api/media
  // então devolvia 404 genérico ("Imagem não encontrada"), indistinguível de
  // uma mídia que de fato nunca existiu — nada nos logs apontava a causa raiz.
  if (!config) {
    console.warn(`⚠️  [Mídia] R2 não configurado (R2_ACCOUNT_ID/R2_ACCESS_KEY_ID/R2_SECRET_ACCESS_KEY/R2_BUCKET_NAME ausentes) — mídia NÃO salva (message_id=${messageId}).`);
    return;
  }
  const cleanBase64 = base64.replace(/^data:[^;]+;base64,/, '');
  const buffer = Buffer.from(cleanBase64, 'base64');

  // Achado numa auditoria externa: só havia .catch() pra erro de rede — uma
  // resposta 401/403/500 do Storage (ex: bucket/policy mal configurados)
  // "terminava com sucesso" sem logar nada. Uma foto de comprovante de
  // pagamento podia se perder silenciosamente, sem nenhum aviso no log.
  try {
    await putObject(config, storagePath(messageId), buffer, mimeType);
  } catch (err: any) {
    console.warn(`⚠️  [Mídia] Falha ao salvar imagem recebida (message_id=${messageId}):`, err.message);
  }
}

export async function getMediaImage(
  supabaseUrl: string | undefined,
  supabaseKey: string | undefined,
  messageId: string
): Promise<{ buffer: Buffer; contentType: string } | null> {
  const config = getObjectStorageConfig();
  const result = config ? await getObject(config, storagePath(messageId)) : null;
  const legacy = result ? null : await getLegacySupabaseStorageObject(supabaseUrl, supabaseKey, storagePath(messageId));
  const found = result || legacy;
  if (!found) return null;
  const contentType = found.contentType || (messageId.startsWith('wa-') ? 'audio/ogg; codecs=opus' : 'image/jpeg');
  return { buffer: found.buffer, contentType };
}
