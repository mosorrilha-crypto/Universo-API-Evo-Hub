/**
 * Etiquetas livres por conversa (tipo WhatsApp Business) — características/
 * sinais que se acumulam ao longo do atendimento (ex: "Interesada en
 * pestañas", "Seña pendiente"), complementares ao estágio único do CRM
 * (crmStage). Texto livre, sem catálogo fixo — normalizado (sem acento,
 * minúsculo) só pra comparação de duplicidade; o texto original digitado é
 * sempre preservado e devolvido.
 */
import { getDb } from './db';

// Faixa Unicode "Combining Diacritical Marks" (U+0300–U+036F) — construída via
// charCode em vez de literal na regex pra evitar ambiguidade de encoding.
const COMBINING_DIACRITICS = new RegExp(`[${String.fromCharCode(0x0300)}-${String.fromCharCode(0x036f)}]`, 'g');

function normalizeLabel(label: string): string {
  return label.trim().normalize('NFD').replace(COMBINING_DIACRITICS, '').toLowerCase();
}

async function getConversationId(tenantId: string, phone: string): Promise<string | undefined> {
  const db = getDb();
  const { data } = await db.from('conversations').select('id').eq('tenant_id', tenantId).eq('phone', phone).maybeSingle();
  return data?.id;
}

/** Etiquetas de uma conversa, na ordem em que foram adicionadas. Lista vazia se a conversa não existir ou não tiver etiquetas. */
export async function listLabels(tenantId: string, phone: string): Promise<string[]> {
  const conversationId = await getConversationId(tenantId, phone);
  if (!conversationId) return [];
  const db = getDb();
  const { data, error } = await db
    .from('conversation_labels')
    .select('label')
    .eq('tenant_id', tenantId)
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return ((data || []) as { label: string }[]).map((row) => row.label);
}

/**
 * Adiciona uma etiqueta — undefined se a conversa não existir. Não duplica
 * se já existir uma etiqueta equivalente (comparação normalizada: sem
 * acento, case-insensitive), mesmo que o texto digitado seja levemente
 * diferente do já cadastrado (ex: "Interesada en pestañas" vs "interesada EN
 * PESTAÑAS" contam como a mesma).
 */
export async function addLabel(tenantId: string, phone: string, label: string): Promise<string[] | undefined> {
  const trimmed = label.trim();
  const conversationId = await getConversationId(tenantId, phone);
  if (!conversationId) return undefined;
  if (!trimmed) return listLabels(tenantId, phone);

  const existing = await listLabels(tenantId, phone);
  const normalizedNew = normalizeLabel(trimmed);
  const alreadyExists = existing.some((l) => normalizeLabel(l) === normalizedNew);
  if (alreadyExists) return existing;

  const db = getDb();
  const { error } = await db.from('conversation_labels').insert({ tenant_id: tenantId, conversation_id: conversationId, label: trimmed });
  if (error) throw error;
  return listLabels(tenantId, phone);
}

/** Remove pelo texto exato (o painel manda de volta o texto como veio de listLabels/addLabel). */
export async function removeLabel(tenantId: string, phone: string, label: string): Promise<string[] | undefined> {
  const conversationId = await getConversationId(tenantId, phone);
  if (!conversationId) return undefined;
  const db = getDb();
  await db.from('conversation_labels').delete().eq('tenant_id', tenantId).eq('conversation_id', conversationId).eq('label', label);
  return listLabels(tenantId, phone);
}

/** Todas as etiquetas distintas já usadas no tenant (uma por texto normalizado) — sugestões de autocomplete no painel. */
export async function listAllTenantLabels(tenantId: string): Promise<string[]> {
  const db = getDb();
  const { data, error } = await db.from('conversation_labels').select('label').eq('tenant_id', tenantId);
  if (error) throw error;
  const seen = new Map<string, string>();
  for (const row of (data || []) as { label: string }[]) {
    const key = normalizeLabel(row.label);
    if (!seen.has(key)) seen.set(key, row.label);
  }
  return Array.from(seen.values());
}

/**
 * Renomeia uma etiqueta em TODAS as conversas do tenant de uma vez (pedido
 * real, 20/08/2026: não existia forma de corrigir um texto digitado errado
 * sem remover e recriar manualmente conversa por conversa — a etiqueta
 * também não tinha catálogo próprio, só existe como texto solto em cada
 * linha de conversation_labels). Quando a conversa já tem a etiqueta nova
 * (ex: renomear "turno confirmado" pra "Turno confirmado" quando essa
 * conversa já tinha as duas por engano), a linha antiga só é removida em vez
 * de criar duplicata — mesma regra de normalização de addLabel.
 */
export async function renameLabelForTenant(tenantId: string, oldLabel: string, newLabel: string): Promise<{ renamedCount: number }> {
  const trimmedNew = newLabel.trim();
  if (!trimmedNew) throw new Error('Novo texto da etiqueta não pode ser vazio.');
  const db = getDb();
  const { data, error } = await db.from('conversation_labels').select('id, conversation_id, label').eq('tenant_id', tenantId);
  if (error) throw error;
  const rows = (data || []) as { id: string; conversation_id: string; label: string }[];
  const oldKey = normalizeLabel(oldLabel);
  const newKey = normalizeLabel(trimmedNew);
  const matching = rows.filter((r) => normalizeLabel(r.label) === oldKey);
  let renamedCount = 0;
  for (const row of matching) {
    const dup = rows.some((r) => r.id !== row.id && r.conversation_id === row.conversation_id && normalizeLabel(r.label) === newKey);
    if (dup) {
      await db.from('conversation_labels').delete().eq('id', row.id);
    } else {
      await db.from('conversation_labels').update({ label: trimmedNew }).eq('id', row.id);
    }
    renamedCount++;
  }
  return { renamedCount };
}

/** Remove uma etiqueta de TODAS as conversas do tenant de uma vez — pra tirar do catálogo de sugestões uma etiqueta obsoleta/digitada errado. */
export async function deleteLabelForTenant(tenantId: string, label: string): Promise<{ deletedCount: number }> {
  const db = getDb();
  const { data, error } = await db.from('conversation_labels').select('id, label').eq('tenant_id', tenantId);
  if (error) throw error;
  const key = normalizeLabel(label);
  const matching = (data || []) as { id: string; label: string }[];
  const toDelete = matching.filter((r) => normalizeLabel(r.label) === key);
  for (const row of toDelete) {
    await db.from('conversation_labels').delete().eq('id', row.id);
  }
  return { deletedCount: toDelete.length };
}

/** Etiquetas distintas do tenant com quantas conversas usam cada uma — base da tela "Gerenciar etiquetas" (renomear/apagar do catálogo). */
export async function listAllTenantLabelsWithUsage(tenantId: string): Promise<{ label: string; usageCount: number }[]> {
  const db = getDb();
  const { data, error } = await db.from('conversation_labels').select('label').eq('tenant_id', tenantId);
  if (error) throw error;
  const byKey = new Map<string, { label: string; usageCount: number }>();
  for (const row of (data || []) as { label: string }[]) {
    const key = normalizeLabel(row.label);
    const entry = byKey.get(key);
    if (entry) entry.usageCount++;
    else byKey.set(key, { label: row.label, usageCount: 1 });
  }
  return Array.from(byKey.values()).sort((a, b) => b.usageCount - a.usageCount);
}

/** Etiquetas de todas as conversas de um tenant, agrupadas por conversation_id — evita N+1 query em listConversations. */
export async function listLabelsByConversationId(tenantId: string): Promise<Map<string, string[]>> {
  const db = getDb();
  const { data, error } = await db
    .from('conversation_labels')
    .select('conversation_id, label')
    .eq('tenant_id', tenantId)
    .order('created_at', { ascending: true });
  if (error) throw error;
  const map = new Map<string, string[]>();
  for (const row of (data || []) as { conversation_id: string; label: string }[]) {
    const arr = map.get(row.conversation_id) || [];
    arr.push(row.label);
    map.set(row.conversation_id, arr);
  }
  return map;
}
