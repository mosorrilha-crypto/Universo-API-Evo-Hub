/**
 * TASK-XXXX (pedido direto, achado real de egress em produção): o bucket
 * privado "app-data" do Supabase Storage (mídia de WhatsApp — fotos/áudios/
 * vídeos recebidos, fotos de exemplo/vídeos/documentos da Base de
 * Conhecimento) sozinho respondeu por ~91% do egress do ciclo de
 * faturamento (6,1 MB de 6,75 MB nas últimas 24h auditadas), estourando a
 * cota do plano Free do Supabase — mesma classe de incidente já documentada
 * em TASK-0074/0075/0218 (fotos da KB em Base64 no JSON), agora vindo do
 * PRÓPRIO Storage, não mais do JSON.
 *
 * Cloudflare R2 (S3-compatível) não cobra egress — a causa raiz do estouro
 * deixa de existir movendo o mesmo binário pra lá. Módulo único com as 3
 * operações primitivas (put/get/delete) que os 4 arquivos de storage
 * (knowledgeBaseImageStore.ts, knowledgeBaseVideoStore.ts,
 * mediaImageStore.ts, knowledgeBaseDocumentStore.ts) já usavam contra a API
 * REST do Supabase Storage — eles trocam só a chamada interna por este
 * módulo, mantendo a MESMA assinatura exportada (inclusive os parâmetros
 * `supabaseUrl`/`supabaseKey`, agora ignorados) pra não precisar tocar nos
 * ~45 pontos de chamada nem nos testes existentes.
 *
 * Credenciais vêm de variáveis de ambiente (mesmo padrão de configuração
 * simples já usado no projeto, ex: SUPABASE_URL/SUPABASE_KEY):
 *   R2_ACCOUNT_ID       — Account ID do Cloudflare (painel R2 → Overview)
 *   R2_ACCESS_KEY_ID    — Access Key ID do token de API R2 (permissão Object Read & Write)
 *   R2_SECRET_ACCESS_KEY — Secret Access Key do mesmo token
 *   R2_BUCKET_NAME      — nome do bucket R2 (privado — nunca público, mesma
 *                         política de acesso via rota autenticada já usada
 *                         pro bucket "app-data")
 */
import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';

export interface ObjectStorageConfig {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
}

/** `undefined` quando qualquer uma das 4 variáveis de ambiente estiver ausente — cada chamador decide o fallback (mesmo padrão de "Storage não configurado" já usado pro Supabase). */
export function getObjectStorageConfig(): ObjectStorageConfig | undefined {
  const accountId = process.env.R2_ACCOUNT_ID;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  const bucket = process.env.R2_BUCKET_NAME;
  if (!accountId || !accessKeyId || !secretAccessKey || !bucket) return undefined;
  return { accountId, accessKeyId, secretAccessKey, bucket };
}

let cachedClient: { client: S3Client; accountId: string; accessKeyId: string; secretAccessKey: string } | undefined;

/** Reaproveita o mesmo S3Client entre chamadas (evita reconstruir a assinatura/conexão a cada upload/download) — só recria se as credenciais mudarem (ex: troca em runtime num teste). */
function getClient(config: ObjectStorageConfig): S3Client {
  if (
    cachedClient &&
    cachedClient.accountId === config.accountId &&
    cachedClient.accessKeyId === config.accessKeyId &&
    cachedClient.secretAccessKey === config.secretAccessKey
  ) {
    return cachedClient.client;
  }
  const client = new S3Client({
    region: 'auto',
    endpoint: `https://${config.accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
  });
  cachedClient = { client, accountId: config.accountId, accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey };
  return client;
}

export async function putObject(config: ObjectStorageConfig, key: string, buffer: Buffer, contentType: string): Promise<void> {
  const client = getClient(config);
  await client.send(new PutObjectCommand({ Bucket: config.bucket, Key: key, Body: buffer, ContentType: contentType || 'application/octet-stream' }));
}

/** `null` quando o objeto não existe (mesmo contrato dos getters que este módulo substitui) — qualquer outro erro (credencial inválida, bucket errado) propaga, pra não mascarar um problema real de configuração como "mídia ausente". */
export async function getObject(config: ObjectStorageConfig, key: string): Promise<{ buffer: Buffer; contentType: string } | null> {
  const client = getClient(config);
  try {
    const result = await client.send(new GetObjectCommand({ Bucket: config.bucket, Key: key }));
    const bytes = await result.Body?.transformToByteArray();
    if (!bytes) return null;
    return { buffer: Buffer.from(bytes), contentType: result.ContentType || 'application/octet-stream' };
  } catch (err: any) {
    if (err?.name === 'NoSuchKey' || err?.$metadata?.httpStatusCode === 404) return null;
    throw err;
  }
}

export async function deleteObject(config: ObjectStorageConfig, key: string): Promise<void> {
  const client = getClient(config);
  await client.send(new DeleteObjectCommand({ Bucket: config.bucket, Key: key }));
}
