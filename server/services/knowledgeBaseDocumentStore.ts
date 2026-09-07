/**
 * Upload real dos documentos anexados à base de conhecimento (aba
 * "Documentos Anexados" do painel) — até aqui era só um registro visual
 * fictício (o preset da Monique tinha 2 "documentos" hardcoded que nunca
 * existiram de verdade, achado real numa auditoria). Sob o prefixo
 * kb-docs/{tenantId}/{docId} — nunca público, autenticado por rota.
 *
 * TASK-XXXX (achado real, 07/09/2026): migrado pra Cloudflare R2 junto com
 * knowledgeBaseImageStore.ts/knowledgeBaseVideoStore.ts/mediaImageStore.ts
 * — mesmo motivo (egress do Supabase Storage estourando a cota do plano
 * Free). Ver comentário completo em knowledgeBaseImageStore.ts.
 */
import { PDFParse } from 'pdf-parse';
import { getObjectStorageConfig, putObject, getObject, deleteObject } from './objectStorage';

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
      // pdf-parse v2 trocou a função direta por uma classe (`PDFParse`) — o
      // `pageJoiner: ''` evita o novo marcador de fim de página que a lib
      // passou a inserir por padrão ("-- N of M --"), mantendo o texto
      // extraído limpo (mesmo formato que ia pro prompt do agente antes).
      const parser = new PDFParse({ data: buffer });
      try {
        const parsed = await parser.getText({ pageJoiner: '' });
        return parsed.text?.trim().slice(0, MAX_EXTRACTED_TEXT_CHARS) || undefined;
      } finally {
        await parser.destroy();
      }
    }
    if (TEXT_MIME_TYPES.has(mimeType) || /\.(txt|csv|json|md)$/i.test(fileName)) {
      return buffer.toString('utf-8').trim().slice(0, MAX_EXTRACTED_TEXT_CHARS) || undefined;
    }
    return undefined;
  } catch {
    // Nome, tipo e erro podem carregar conteúdo controlado por upload. O log
    // fixo mantém a observabilidade sem abrir espaço para injeção de linhas.
    console.warn('⚠️  [KB Documentos] Falha ao extrair texto de documento enviado.');
    return undefined;
  }
}

function storagePath(tenantId: string, docId: string): string {
  return `kb-docs/${encodeURIComponent(tenantId)}/${encodeURIComponent(docId)}`;
}

export async function uploadKnowledgeBaseDocument(
  _supabaseUrl: string | undefined,
  _supabaseKey: string | undefined,
  tenantId: string,
  docId: string,
  buffer: Buffer,
  mimeType: string
): Promise<void> {
  const config = getObjectStorageConfig();
  if (!config) throw new Error('Storage não configurado (R2_ACCOUNT_ID/R2_ACCESS_KEY_ID/R2_SECRET_ACCESS_KEY/R2_BUCKET_NAME ausentes).');
  await putObject(config, storagePath(tenantId, docId), buffer, mimeType || 'application/octet-stream');
}

export async function getKnowledgeBaseDocument(
  _supabaseUrl: string | undefined,
  _supabaseKey: string | undefined,
  tenantId: string,
  docId: string
): Promise<{ buffer: Buffer; contentType: string } | null> {
  const config = getObjectStorageConfig();
  if (!config) return null;
  const result = await getObject(config, storagePath(tenantId, docId));
  if (!result) return null;
  return { buffer: result.buffer, contentType: result.contentType || 'application/octet-stream' };
}

export async function deleteKnowledgeBaseDocument(
  _supabaseUrl: string | undefined,
  _supabaseKey: string | undefined,
  tenantId: string,
  docId: string
): Promise<void> {
  const config = getObjectStorageConfig();
  if (!config) return;
  try {
    await deleteObject(config, storagePath(tenantId, docId));
  } catch (err: any) {
    console.warn('⚠️  [KB Documentos] Falha ao apagar arquivo do Storage:', { tenantId, docId, error: err.message });
  }
}
