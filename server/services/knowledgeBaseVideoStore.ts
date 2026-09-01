/**
 * Upload real de vídeo de exemplo de produto/serviço pra base de
 * conhecimento — pedido real do dono do produto: o agente (ou o operador
 * manualmente) mandar um vídeo de verdade pro lead, geralmente de até ~1
 * minuto, além da foto que já existia (Epic 4.5.2). Mesmo bucket privado
 * "app-data" já usado por mediaImageStore.ts e knowledgeBaseDocumentStore.ts,
 * sob o prefixo kb-video/{tenantId}/{videoId} — nunca público, autenticado
 * por rota.
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
const BUCKET = 'app-data';

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

/**
 * TASK-0200 — CodeQL sinalizou "File data in outbound network request"
 * (Medium, `js/file-data-in-outbound-network-request`): dado binário
 * (`buffer`) é enviado a `supabaseUrl` sem validar essa URL antes.
 * `supabaseUrl` vem sempre de configuração do servidor (env
 * `SUPABASE_URL`), nunca de input por requisição — mesma checagem
 * estrutural (URL bem-formada, protocolo http/https) já usada como segunda
 * camada em `evolutionSend.ts`/`admin.ts`/`mediaImageStore.ts` (TASK-0197/0200).
 */
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

export async function uploadKnowledgeBaseVideo(
  supabaseUrl: string | undefined,
  supabaseKey: string | undefined,
  tenantId: string,
  videoId: string,
  buffer: Buffer,
  mimeType: string
): Promise<void> {
  if (!supabaseUrl || !supabaseKey) throw new Error('Storage não configurado (SUPABASE_URL/SUPABASE_KEY ausentes).');
  assertValidHttpUrl(supabaseUrl);
  const res = await fetch(`${supabaseUrl}/storage/v1/object/${BUCKET}/${storagePath(tenantId, videoId)}`, {
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
    throw new Error(`Falha ao enviar vídeo pro Storage: HTTP ${res.status} — ${body.slice(0, 300)}`);
  }
}

export async function getKnowledgeBaseVideo(
  supabaseUrl: string | undefined,
  supabaseKey: string | undefined,
  tenantId: string,
  videoId: string
): Promise<{ buffer: Buffer; contentType: string } | null> {
  if (!supabaseUrl || !supabaseKey) return null;
  assertValidHttpUrl(supabaseUrl);
  const res = await fetch(`${supabaseUrl}/storage/v1/object/${BUCKET}/${storagePath(tenantId, videoId)}`, {
    headers: { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}` },
  });
  if (!res.ok) return null;
  const buffer = Buffer.from(await res.arrayBuffer());
  const contentType = res.headers.get('content-type') || 'video/mp4';
  return { buffer, contentType };
}

/** Melhor esforço: chamado ao trocar o vídeo de um produto por outro, pra não acumular lixo no Storage a cada troca. Nunca deve travar o upload novo se falhar. */
export async function deleteKnowledgeBaseVideo(
  supabaseUrl: string | undefined,
  supabaseKey: string | undefined,
  tenantId: string,
  videoId: string
): Promise<void> {
  if (!supabaseUrl || !supabaseKey) return;
  try {
    assertValidHttpUrl(supabaseUrl);
    const res = await fetch(`${supabaseUrl}/storage/v1/object/${BUCKET}/${storagePath(tenantId, videoId)}`, {
      method: 'DELETE',
      headers: { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}` },
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      console.warn(`⚠️  [KB Vídeo] Falha ao apagar vídeo antigo do Storage (tenant=${tenantId}, video=${videoId}): HTTP ${res.status} — ${body.slice(0, 300)}`);
    }
  } catch (err: any) {
    console.warn(`⚠️  [KB Vídeo] Falha ao apagar vídeo antigo do Storage (tenant=${tenantId}, video=${videoId}):`, err.message);
  }
}
