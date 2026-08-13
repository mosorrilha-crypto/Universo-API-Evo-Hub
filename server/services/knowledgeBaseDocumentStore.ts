/**
 * Upload real dos documentos anexados à base de conhecimento (aba
 * "Documentos Anexados" do painel) — até aqui era só um registro visual
 * fictício (o preset da Monique tinha 2 "documentos" hardcoded que nunca
 * existiram de verdade, achado real numa auditoria). Mesmo bucket privado
 * "app-data" já usado por mediaImageStore.ts, sob o prefixo
 * kb-docs/{tenantId}/{docId} — nunca público, autenticado por rota.
 */
import pdfParse from 'pdf-parse';

const BUCKET = 'app-data';

/** Tamanho máximo do texto extraído guardado por documento — o teto de prompt real (DOCUMENTS_PROMPT_CHAR_BUDGET, knowledgeBaseStore.ts) já limita o que entra no Gemini; isso só evita guardar um texto gigante no banco à toa. */
const MAX_EXTRACTED_TEXT_CHARS = 8000;

const TEXT_MIME_TYPES = new Set(['text/plain', 'text/csv', 'application/json', 'text/markdown']);

/**
 * Extrai texto do arquivo pra o agente poder "ler" o conteúdo — só pra
 * tipos com extração implementada (PDF via pdf-parse, local, sem custo de
 * API; texto puro lido direto). DOCX/outros ficam sem extractedText — o
 * documento continua salvo e baixável, só não entra no prompt do agente.
 * Nunca lança: uma falha de extração não pode impedir o upload do arquivo.
 */
export async function extractTextFromDocument(buffer: Buffer, mimeType: string, fileName: string): Promise<string | undefined> {
  try {
    if (mimeType === 'application/pdf' || fileName.toLowerCase().endsWith('.pdf')) {
      const parsed = await pdfParse(buffer);
      return parsed.text?.trim().slice(0, MAX_EXTRACTED_TEXT_CHARS) || undefined;
    }
    if (TEXT_MIME_TYPES.has(mimeType) || /\.(txt|csv|json|md)$/i.test(fileName)) {
      return buffer.toString('utf-8').trim().slice(0, MAX_EXTRACTED_TEXT_CHARS) || undefined;
    }
    return undefined;
  } catch (err: any) {
    console.warn(`⚠️  [KB Documentos] Falha ao extrair texto de "${fileName}" (${mimeType}):`, err.message);
    return undefined;
  }
}

function storagePath(tenantId: string, docId: string): string {
  return `kb-docs/${encodeURIComponent(tenantId)}/${encodeURIComponent(docId)}`;
}

export async function uploadKnowledgeBaseDocument(
  supabaseUrl: string | undefined,
  supabaseKey: string | undefined,
  tenantId: string,
  docId: string,
  buffer: Buffer,
  mimeType: string
): Promise<void> {
  if (!supabaseUrl || !supabaseKey) throw new Error('Storage não configurado (SUPABASE_URL/SUPABASE_KEY ausentes).');
  const res = await fetch(`${supabaseUrl}/storage/v1/object/${BUCKET}/${storagePath(tenantId, docId)}`, {
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
    throw new Error(`Falha ao enviar arquivo pro Storage: HTTP ${res.status} — ${body.slice(0, 300)}`);
  }
}

export async function getKnowledgeBaseDocument(
  supabaseUrl: string | undefined,
  supabaseKey: string | undefined,
  tenantId: string,
  docId: string
): Promise<{ buffer: Buffer; contentType: string } | null> {
  if (!supabaseUrl || !supabaseKey) return null;
  const res = await fetch(`${supabaseUrl}/storage/v1/object/${BUCKET}/${storagePath(tenantId, docId)}`, {
    headers: { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}` },
  });
  if (!res.ok) return null;
  const buffer = Buffer.from(await res.arrayBuffer());
  const contentType = res.headers.get('content-type') || 'application/octet-stream';
  return { buffer, contentType };
}

export async function deleteKnowledgeBaseDocument(
  supabaseUrl: string | undefined,
  supabaseKey: string | undefined,
  tenantId: string,
  docId: string
): Promise<void> {
  if (!supabaseUrl || !supabaseKey) return;
  const res = await fetch(`${supabaseUrl}/storage/v1/object/${BUCKET}/${storagePath(tenantId, docId)}`, {
    method: 'DELETE',
    headers: { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}` },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    console.warn(`⚠️  [KB Documentos] Falha ao apagar arquivo do Storage (tenant=${tenantId}, doc=${docId}): HTTP ${res.status} — ${body.slice(0, 300)}`);
  }
}
