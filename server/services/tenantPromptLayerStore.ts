/**
 * Camada 1 (Global) por tenant (pedido real do dono do produto, 18/08/2026)
 * — complementa globalPromptStore.ts. Até aqui a Camada 1 era uma única
 * linha compartilhada por TODOS os tenants, editável só por saas_admin; o
 * admin de um tenant não tinha como nem ler esse texto, risco real de
 * duplicar ou entrar em conflito com uma regra que já está coberta ali.
 *
 * Sem linha em `tenant_prompt_layer` pra um tenant = ele ainda HERDA a
 * Camada 1 global (resolveEffectiveGlobalLayer abaixo). Assim que o tenant
 * edita a própria cópia, ganha uma linha aqui e NUNCA MAIS herda mudança
 * futura da global automaticamente — decisão explícita do dono do produto
 * (simples e previsível; reverter e voltar a herdar é sempre possível
 * apagando a linha, ver clearTenantPromptLayer).
 */
import { getDb } from './db';
import { getGlobalPromptLayerOverride, DEFAULT_GLOBAL_LAYER } from './globalPromptStore';

export interface TenantPromptLayerRow {
  /** Texto efetivo em vigor pra este tenant agora — a cópia própria dele se existir, senão o que a Camada 1 global usa (override ou padrão). */
  content: string;
  /** true = este tenant já tem cópia própria (editou pelo menos uma vez), independente da Camada 1 global daqui pra frente. */
  isCustomized: boolean;
  updatedAt: string | null;
  updatedBy: string | null;
}

/** Texto que a Camada 1 global usa agora (override do saas_admin, ou o padrão hardcoded) — mesma resolução que autoReply.ts já fazia antes desta mudança. */
async function resolveGlobalLayerContent(): Promise<string> {
  return (await getGlobalPromptLayerOverride().catch(() => null)) || DEFAULT_GLOBAL_LAYER;
}

/** Usado de verdade na hora de montar o prompt (autoReply.ts) — tenant customizado tem prioridade, senão cai na Camada 1 global de sempre. */
export async function resolveEffectiveGlobalLayer(tenantId: string): Promise<string> {
  const db = getDb();
  const { data } = await db.from('tenant_prompt_layer').select('content').eq('tenant_id', tenantId).maybeSingle();
  const tenantContent = (data?.content as string | null | undefined)?.trim();
  if (tenantContent) return tenantContent;
  return resolveGlobalLayerContent();
}

/** Usado pela tela do painel — junto com o texto efetivo, informa se é uma cópia customizada ou ainda herdada da Camada 1 global. */
export async function getTenantPromptLayerRow(tenantId: string): Promise<TenantPromptLayerRow> {
  const db = getDb();
  const { data } = await db.from('tenant_prompt_layer').select('content, updated_at, updated_by').eq('tenant_id', tenantId).maybeSingle();
  if (data?.content) {
    return {
      content: data.content as string,
      isCustomized: true,
      updatedAt: (data.updated_at as string | null) ?? null,
      updatedBy: (data.updated_by as string | null) ?? null,
    };
  }
  return {
    content: await resolveGlobalLayerContent(),
    isCustomized: false,
    updatedAt: null,
    updatedBy: null,
  };
}

export async function setTenantPromptLayer(tenantId: string, content: string, updatedBy: string): Promise<void> {
  const db = getDb();
  const { error } = await db
    .from('tenant_prompt_layer')
    .upsert({ tenant_id: tenantId, content: content.trim(), updated_at: new Date().toISOString(), updated_by: updatedBy }, { onConflict: 'tenant_id' });
  if (error) throw error;
}

/** "Restaurar padrão" no painel — apaga a cópia própria do tenant, ele volta a herdar a Camada 1 global (inclusive mudanças futuras) a partir de agora. */
export async function clearTenantPromptLayer(tenantId: string): Promise<void> {
  const db = getDb();
  const { error } = await db.from('tenant_prompt_layer').delete().eq('tenant_id', tenantId);
  if (error) throw error;
}
