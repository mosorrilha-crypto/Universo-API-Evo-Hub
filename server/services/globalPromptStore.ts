/**
 * Camada 1 (Global) do prompt do agente — editável por um saas_admin pelo
 * painel, sem precisar de PR + deploy pra cada ajuste (pedido real do dono
 * do produto, depois de duas rodadas de correção de alucinação de mídia na
 * mesma sessão de desenvolvimento). Singleton (1 linha, id fixo 'global') —
 * é o prompt fixo compartilhado por TODOS os tenants, não um dado por
 * tenant (ver docs/AGENTE-VERTICAL-ARQUITETURA.md seção 1).
 *
 * content NULL (nunca editado, ou resetado pelo admin) = usa
 * DEFAULT_GLOBAL_LAYER hardcoded em autoReply.ts — nunca deixa o agente sem
 * nenhuma camada Global no ar só porque a linha do banco está vazia.
 */
import { getDb } from './db';

const ROW_ID = 'global';

export async function getGlobalPromptLayerOverride(): Promise<string | null> {
  const db = getDb();
  const { data } = await db.from('global_prompt_layer').select('content').eq('id', ROW_ID).maybeSingle();
  const content = data?.content as string | null | undefined;
  return content?.trim() ? content : null;
}

export interface GlobalPromptLayerRow {
  content: string | null;
  updatedAt: string | null;
  updatedBy: string | null;
}

export async function getGlobalPromptLayerRow(): Promise<GlobalPromptLayerRow> {
  const db = getDb();
  const { data } = await db.from('global_prompt_layer').select('content, updated_at, updated_by').eq('id', ROW_ID).maybeSingle();
  return {
    content: (data?.content as string | null) ?? null,
    updatedAt: (data?.updated_at as string | null) ?? null,
    updatedBy: (data?.updated_by as string | null) ?? null,
  };
}

/** `content: null` reseta pro padrão hardcoded (DEFAULT_GLOBAL_LAYER) — não apaga a linha, só limpa o override. */
export async function setGlobalPromptLayer(content: string | null, updatedBy: string): Promise<void> {
  const db = getDb();
  const { error } = await db
    .from('global_prompt_layer')
    .upsert({ id: ROW_ID, content: content?.trim() || null, updated_at: new Date().toISOString(), updated_by: updatedBy }, { onConflict: 'id' });
  if (error) throw error;
}
