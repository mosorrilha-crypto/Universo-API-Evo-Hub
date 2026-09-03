/**
 * TASK-0218 — migra as imagens inline em Base64 da Base de Conhecimento
 * (foto de exemplo de produto/variante, pares antes/depois do produto e de
 * cada variante, bloco de imagem do 1º contato) pro Storage
 * (server/services/knowledgeBaseImageStore.ts), gravando a nova referência
 * (`*ImageId` + metadados) no lugar do Base64 inline. Achado real que
 * motivou esta migração: TASK-0074/0075, a tabela `knowledge_base` da
 * Monique sozinha chegou a ~12MB, quase tudo foto, causa raiz confirmada do
 * estouro de egress do plano Free do Supabase.
 *
 * Uso:
 *   SUPABASE_URL=... SUPABASE_KEY=... npx tsx scripts/migrate-knowledge-base-images.ts [opções]
 *
 * Opções:
 *   --apply                  Executa de verdade (sobe pro Storage e grava a
 *                             nova referência na Base de Conhecimento). SEM
 *                             essa flag roda em modo dry-run: só relata o
 *                             que faria, não altera nada — comportamento
 *                             padrão, seguro rodar quantas vezes quiser.
 *   --tenant <tenantId>       Restringe a migração a um único tenant.
 *   --limit <n>               Limite global de quantas imagens processar
 *                             nesta execução (útil pra rodar em lotes
 *                             pequenos numa primeira validação).
 *   --remove-legacy-base64    SÓ tem efeito junto com --apply. Depois de
 *                             confirmar o upload e gravar a referência nova,
 *                             remove também o campo `*Base64` legado do
 *                             mesmo item. NUNCA roda por padrão — é um passo
 *                             separado e deliberado, pra rodar só depois de
 *                             validar (em produção) que os downloads/envios
 *                             pelo agente continuam funcionando com a
 *                             referência nova. Sem essa flag, o Base64
 *                             legado fica registrado ao lado da referência
 *                             nova até essa segunda execução explícita.
 *
 * Idempotente: um item com `*ImageId` já preenchido é considerado já
 * migrado e é pulado (nunca reprocessado, nunca duplica upload). Dentro de
 * uma mesma execução, o SHA-256 do conteúdo decodificado evita subir a
 * MESMA imagem duas vezes quando ela aparece em mais de um campo do mesmo
 * tenant (ex: a mesma foto usada como exemplo do produto e de uma variante).
 *
 * Nunca imprime Base64/conteúdo binário nos logs — só contagens, ids,
 * tamanhos em bytes e hashes (que não permitem reconstruir a imagem).
 */
import { createHash } from 'crypto';
import { createClient } from '@supabase/supabase-js';
import { initDb, getPlatformDb } from '../server/services/db';
import { getKnowledgeBase, setKnowledgeBase, type AgentKnowledgeBase, type AgentProduct, type ProductVariant, type BeforeAfterPair } from '../server/services/knowledgeBaseStore';
import { uploadKnowledgeBaseImage, ALLOWED_IMAGE_MIME_TYPES, MAX_IMAGE_BYTES } from '../server/services/knowledgeBaseImageStore';

interface CliOptions {
  apply: boolean;
  tenantId?: string;
  limit?: number;
  removeLegacyBase64: boolean;
}

export function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = { apply: false, removeLegacyBase64: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--apply') options.apply = true;
    else if (arg === '--remove-legacy-base64') options.removeLegacyBase64 = true;
    else if (arg === '--tenant') options.tenantId = argv[++i];
    else if (arg === '--limit') options.limit = Number(argv[++i]);
    else if (arg === '--help' || arg === '-h') {
      console.log('Uso: npx tsx scripts/migrate-knowledge-base-images.ts [--apply] [--tenant <id>] [--limit <n>] [--remove-legacy-base64]');
      process.exit(0);
    }
  }
  if (options.limit !== undefined && (!Number.isFinite(options.limit) || options.limit <= 0)) {
    console.error('❌ --limit precisa ser um número positivo.');
    process.exit(1);
  }
  if (options.removeLegacyBase64 && !options.apply) {
    console.error('❌ --remove-legacy-base64 só tem efeito junto com --apply (dry-run nunca altera nada).');
    process.exit(1);
  }
  return options;
}

/** Decodifica um Base64/Data URI legado; devolve null se não for uma imagem decodificável de verdade. */
export function decodeLegacyImageBase64(raw: string, declaredMimeType: string | undefined): { buffer: Buffer; mimeType: string } | null {
  const dataUriMatch = raw.match(/^data:([^;]+);base64,(.*)$/s);
  const mimeType = (dataUriMatch ? dataUriMatch[1] : declaredMimeType) || 'image/jpeg';
  const base64Part = (dataUriMatch ? dataUriMatch[2] : raw).trim();
  if (!base64Part) return null;
  let buffer: Buffer;
  try {
    buffer = Buffer.from(base64Part, 'base64');
  } catch {
    return null;
  }
  if (buffer.length === 0) return null;
  return { buffer, mimeType };
}

function sha256Hex(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex');
}

interface PendingImageMigration {
  /** Só pra log — nunca contém o Base64/binário em si. */
  describe: string;
  base64: string;
  declaredMimeType?: string;
  applyReference: (ref: { imageId: string; mimeType: string; sizeBytes: number }) => void;
  removeLegacyField: () => void;
}

/**
 * Varre a Base de Conhecimento inteira do tenant e devolve todo campo com
 * Base64 legado que ainda não tem a referência nova (`*ImageId` ausente) —
 * a própria checagem `!*ImageId` é o que torna execuções repetidas
 * idempotentes: um item já migrado nunca aparece de novo aqui.
 */
export function collectPendingMigrations(kb: AgentKnowledgeBase): PendingImageMigration[] {
  const pending: PendingImageMigration[] = [];

  const addBeforeAfterPair = (pair: BeforeAfterPair, label: string) => {
    if (!pair.beforeImageId && pair.beforeImageBase64) {
      pending.push({
        describe: `${label} · antes`,
        base64: pair.beforeImageBase64,
        declaredMimeType: pair.beforeImageMimeType,
        applyReference: (ref) => {
          pair.beforeImageId = ref.imageId;
          pair.beforeImageMimeType = ref.mimeType;
          pair.beforeImageSizeBytes = ref.sizeBytes;
        },
        removeLegacyField: () => { delete pair.beforeImageBase64; },
      });
    }
    if (!pair.afterImageId && pair.afterImageBase64) {
      pending.push({
        describe: `${label} · depois`,
        base64: pair.afterImageBase64,
        declaredMimeType: pair.afterImageMimeType,
        applyReference: (ref) => {
          pair.afterImageId = ref.imageId;
          pair.afterImageMimeType = ref.mimeType;
          pair.afterImageSizeBytes = ref.sizeBytes;
        },
        removeLegacyField: () => { delete pair.afterImageBase64; },
      });
    }
  };

  const addProductOrVariantImage = (item: AgentProduct | ProductVariant, label: string) => {
    if (!item.exampleImageId && item.exampleImageBase64) {
      pending.push({
        describe: label,
        base64: item.exampleImageBase64,
        declaredMimeType: item.exampleImageMimeType,
        applyReference: (ref) => {
          item.exampleImageId = ref.imageId;
          item.exampleImageMimeType = ref.mimeType;
          item.exampleImageSizeBytes = ref.sizeBytes;
        },
        removeLegacyField: () => { delete item.exampleImageBase64; },
      });
    }
  };

  for (const product of kb.products || []) {
    addProductOrVariantImage(product, `produto "${product.name}"`);
    for (const pair of product.beforeAfter || []) addBeforeAfterPair(pair, `produto "${product.name}" · antes/depois ${pair.id}`);
    for (const variant of product.variants || []) {
      addProductOrVariantImage(variant, `produto "${product.name}" · variante "${variant.code}"`);
      for (const pair of variant.beforeAfter || []) addBeforeAfterPair(pair, `produto "${product.name}" · variante "${variant.code}" · antes/depois ${pair.id}`);
    }
  }

  for (const block of kb.firstContactBlocks || []) {
    if (block.type === 'image' && !block.imageId && block.imageBase64) {
      pending.push({
        describe: `bloco de 1º contato ${block.id}`,
        base64: block.imageBase64,
        declaredMimeType: block.imageMimeType,
        applyReference: (ref) => {
          block.imageId = ref.imageId;
          block.imageMimeType = ref.mimeType;
          block.imageSizeBytes = ref.sizeBytes;
        },
        removeLegacyField: () => { delete block.imageBase64; },
      });
    }
  }

  return pending;
}

interface TenantMigrationResult {
  tenantId: string;
  migrated: number;
  skippedAlreadyMigrated: number;
  failed: number;
  bytesMigrated: number;
  legacyRemoved: number;
}

async function migrateTenant(
  tenantId: string,
  options: CliOptions,
  remainingGlobalLimit: { value: number } | null
): Promise<TenantMigrationResult> {
  const result: TenantMigrationResult = { tenantId, migrated: 0, skippedAlreadyMigrated: 0, failed: 0, bytesMigrated: 0, legacyRemoved: 0 };

  const kb = await getKnowledgeBase(tenantId);
  if (!kb) {
    console.log(`— tenant ${tenantId}: sem Base de Conhecimento, nada a migrar.`);
    return result;
  }

  const pending = collectPendingMigrations(kb);
  if (!pending.length) {
    console.log(`— tenant ${tenantId}: nenhuma imagem Base64 legada pendente.`);
    return result;
  }

  const uploadedHashesThisTenant = new Map<string, { imageId: string; mimeType: string; sizeBytes: number }>();
  let changed = false;

  for (const item of pending) {
    if (remainingGlobalLimit && remainingGlobalLimit.value <= 0) {
      console.log(`— tenant ${tenantId}: limite global (--limit) atingido, ${pending.length - result.migrated - result.failed} item(ns) restante(s) ficam pra próxima execução.`);
      break;
    }

    const decoded = decodeLegacyImageBase64(item.base64, item.declaredMimeType);
    if (!decoded) {
      console.warn(`  ⚠️  ${item.describe}: Base64 inválido/vazio, pulando este item (não afeta os demais).`);
      result.failed++;
      continue;
    }
    if (decoded.buffer.length > MAX_IMAGE_BYTES) {
      console.warn(`  ⚠️  ${item.describe}: ${(decoded.buffer.length / (1024 * 1024)).toFixed(1)}MB, acima do limite de ${MAX_IMAGE_BYTES / (1024 * 1024)}MB da Meta — pulando (precisa ser comprimida manualmente antes).`);
      result.failed++;
      continue;
    }
    const resolvedMimeType = decoded.mimeType.split(';')[0].trim();
    if (!ALLOWED_IMAGE_MIME_TYPES.has(resolvedMimeType)) {
      console.warn(`  ⚠️  ${item.describe}: formato "${resolvedMimeType}" não aceito (só JPEG/PNG/WebP) — pulando.`);
      result.failed++;
      continue;
    }

    const hash = sha256Hex(decoded.buffer);
    let uploaded = uploadedHashesThisTenant.get(hash);

    try {
      if (!uploaded) {
        const imageId = `image-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        if (options.apply) {
          await uploadKnowledgeBaseImage(process.env.SUPABASE_URL, process.env.SUPABASE_KEY, tenantId, imageId, decoded.buffer, resolvedMimeType);
        }
        uploaded = { imageId, mimeType: resolvedMimeType, sizeBytes: decoded.buffer.length };
        uploadedHashesThisTenant.set(hash, uploaded);
      }

      // A referência só é escrita DEPOIS do upload confirmado (ou simulada em dry-run, sem persistir).
      if (options.apply) {
        item.applyReference(uploaded);
        changed = true;
        if (options.removeLegacyBase64) {
          item.removeLegacyField();
          result.legacyRemoved++;
        }
      }

      console.log(`  ✅ ${options.apply ? '' : '[dry-run] '}${item.describe}: ${(decoded.buffer.length / 1024).toFixed(0)}KB, sha256=${hash.slice(0, 12)}…${options.apply ? `, imageId=${uploaded.imageId}` : ''}`);
      result.migrated++;
      result.bytesMigrated += decoded.buffer.length;
      if (remainingGlobalLimit) remainingGlobalLimit.value--;
    } catch (err: any) {
      console.error(`  ❌ ${item.describe}: falha ao migrar — ${err.message}`);
      result.failed++;
    }
  }

  if (options.apply && changed) {
    await setKnowledgeBase(tenantId, kb);
  }

  return result;
}

async function listTenantIdsWithKnowledgeBase(): Promise<string[]> {
  const { data, error } = await getPlatformDb().from('knowledge_base').select('tenant_id');
  if (error) throw error;
  return (data || []).map((row: any) => row.tenant_id as string);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_KEY;
  if (!supabaseUrl || !supabaseKey) {
    console.error('❌ Defina SUPABASE_URL e SUPABASE_KEY no ambiente antes de rodar este script.');
    process.exit(1);
  }
  initDb(createClient(supabaseUrl, supabaseKey));

  console.log(`Migração de imagens inline da Base de Conhecimento — modo ${options.apply ? 'APLICAR (grava de verdade)' : 'DRY-RUN (nada é alterado)'}.`);
  if (options.tenantId) console.log(`Restrito ao tenant ${options.tenantId}.`);
  if (options.limit) console.log(`Limite global desta execução: ${options.limit} imagem(ns).`);
  if (options.removeLegacyBase64) console.log('⚠️  --remove-legacy-base64 ativo: o Base64 legado será removido dos itens migrados nesta execução.');
  console.log('');

  const tenantIds = options.tenantId ? [options.tenantId] : await listTenantIdsWithKnowledgeBase();
  const remainingGlobalLimit = options.limit ? { value: options.limit } : null;

  const totals: TenantMigrationResult = { tenantId: '(todos)', migrated: 0, skippedAlreadyMigrated: 0, failed: 0, bytesMigrated: 0, legacyRemoved: 0 };

  for (const tenantId of tenantIds) {
    if (remainingGlobalLimit && remainingGlobalLimit.value <= 0) {
      console.log(`— tenant ${tenantId}: limite global já atingido por um tenant anterior, ficando pra próxima execução.`);
      continue;
    }
    const result = await migrateTenant(tenantId, options, remainingGlobalLimit);
    totals.migrated += result.migrated;
    totals.failed += result.failed;
    totals.bytesMigrated += result.bytesMigrated;
    totals.legacyRemoved += result.legacyRemoved;
  }

  console.log('\n— Resumo —');
  console.log(`Tenants processados: ${tenantIds.length}`);
  console.log(`Imagens ${options.apply ? 'migradas' : 'que seriam migradas'}: ${totals.migrated}`);
  console.log(`Bytes ${options.apply ? 'migrados' : 'que seriam migrados'}: ${(totals.bytesMigrated / (1024 * 1024)).toFixed(2)}MB`);
  console.log(`Itens com falha (pulados, não bloquearam o restante): ${totals.failed}`);
  if (options.removeLegacyBase64) console.log(`Campos Base64 legados removidos: ${totals.legacyRemoved}`);
  if (!options.apply) console.log('\nNenhuma alteração foi feita (modo dry-run). Rode de novo com --apply pra migrar de verdade.');
}

// Só roda main() quando o arquivo é executado diretamente (npx tsx ...) —
// importar as funções puras exportadas acima (ex: em teste) nunca dispara
// a migração de verdade.
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error('❌ Migração falhou:', err);
    process.exit(1);
  });
}
