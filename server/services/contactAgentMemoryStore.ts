import { getDb } from './db';

export type AgentMemoryUpdatedBy = 'system' | 'operator';

export interface ContactMemoryOpenLoop {
  kind: 'agenda' | 'payment' | 'escalation' | 'follow_up';
  summary: string;
  status?: 'open' | 'awaiting_customer' | 'awaiting_human';
}

export type ContactMemoryFacts = Record<string, string | number | boolean>;

export interface ContactAgentMemory {
  tenant_id: string;
  phone: string;
  preferred_language: string | null;
  preferred_name: string | null;
  current_intent: string | null;
  service_interest: string | null;
  objections: string[];
  facts_confirmed: ContactMemoryFacts;
  open_loops: ContactMemoryOpenLoop[];
  next_best_action: string | null;
  conversation_summary: string | null;
  updated_by: AgentMemoryUpdatedBy;
  created_at: string;
  updated_at: string;
}

export interface ContactAgentMemoryPatch {
  preferredLanguage?: string | null;
  preferredName?: string | null;
  currentIntent?: string | null;
  serviceInterest?: string | null;
  objections?: string[];
  factsConfirmed?: ContactMemoryFacts;
  openLoops?: ContactMemoryOpenLoop[];
  nextBestAction?: string | null;
  conversationSummary?: string | null;
  updatedBy?: AgentMemoryUpdatedBy;
}

const MAX_TEXT_LENGTH = 240;
const MAX_SUMMARY_LENGTH = 900;
const MAX_LIST_ITEMS = 8;
// Estados vivos são sempre resolvidos dos stores próprios a cada turno; memória
// jamais pode virar uma cópia autorizativa de pagamento, agenda ou escalonamento.
const DISALLOWED_FACT_KEY = /(?:token|secret|password|base64|media|receipt|comprovante|document|prompt|history|message|phone|email|payment|pagamento|appointment|agenda|booking|calendar|escalation|escalonamento)/i;

function asTrimmedText(value: unknown, maxLength = MAX_TEXT_LENGTH): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.replace(/\s+/g, ' ').trim();
  return normalized ? normalized.slice(0, maxLength) : null;
}

function normalizeStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const item of value) {
    const normalized = asTrimmedText(item, 160);
    if (!normalized) continue;
    const key = normalized.toLocaleLowerCase('pt-BR');
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(normalized);
    if (result.length >= MAX_LIST_ITEMS) break;
  }
  return result;
}

export function normalizeMemoryFacts(value: unknown): ContactMemoryFacts {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const result: ContactMemoryFacts = {};
  for (const [rawKey, rawValue] of Object.entries(value as Record<string, unknown>)) {
    const key = rawKey.replace(/[^a-zA-Z0-9_.-]/g, '').slice(0, 60);
    if (!key || DISALLOWED_FACT_KEY.test(key)) continue;
    if (typeof rawValue === 'boolean') {
      result[key] = rawValue;
    } else if (typeof rawValue === 'number' && Number.isFinite(rawValue)) {
      result[key] = rawValue;
    } else {
      const text = asTrimmedText(rawValue, 160);
      if (text) result[key] = text;
    }
  }
  return result;
}

export function normalizeOpenLoops(value: unknown): ContactMemoryOpenLoop[] {
  if (!Array.isArray(value)) return [];
  const result: ContactMemoryOpenLoop[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    const row = item as Record<string, unknown>;
    const kind = row.kind === 'agenda' || row.kind === 'payment' || row.kind === 'escalation' || row.kind === 'follow_up'
      ? row.kind
      : null;
    const summary = asTrimmedText(row.summary, 200);
    if (!kind || !summary) continue;
    const status = row.status === 'open' || row.status === 'awaiting_customer' || row.status === 'awaiting_human'
      ? row.status
      : undefined;
    const dedupeKey = `${kind}:${summary.toLocaleLowerCase('pt-BR')}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    result.push({ kind, summary, ...(status ? { status } : {}) });
    if (result.length >= MAX_LIST_ITEMS) break;
  }
  return result;
}

function normalizeUpdatedBy(value: unknown): AgentMemoryUpdatedBy {
  return value === 'operator' ? 'operator' : 'system';
}

function normalizeNullableText(value: unknown, maxLength = MAX_TEXT_LENGTH): string | null {
  return asTrimmedText(value, maxLength);
}

export function normalizeContactAgentMemory(row: Partial<ContactAgentMemory> & Record<string, unknown>): ContactAgentMemory {
  return {
    tenant_id: typeof row.tenant_id === 'string' ? row.tenant_id : '',
    phone: typeof row.phone === 'string' ? row.phone : '',
    preferred_language: normalizeNullableText(row.preferred_language, 32),
    preferred_name: normalizeNullableText(row.preferred_name, 120),
    current_intent: normalizeNullableText(row.current_intent, 80),
    service_interest: normalizeNullableText(row.service_interest, 160),
    objections: normalizeStringList(row.objections),
    facts_confirmed: normalizeMemoryFacts(row.facts_confirmed),
    open_loops: normalizeOpenLoops(row.open_loops),
    next_best_action: normalizeNullableText(row.next_best_action, 240),
    conversation_summary: normalizeNullableText(row.conversation_summary, MAX_SUMMARY_LENGTH),
    updated_by: normalizeUpdatedBy(row.updated_by),
    created_at: typeof row.created_at === 'string' ? row.created_at : new Date(0).toISOString(),
    updated_at: typeof row.updated_at === 'string' ? row.updated_at : new Date(0).toISOString(),
  };
}

/**
 * Une apenas fatos operacionais explícitos. Campos omitidos no patch permanecem
 * como estavam; não é permitido apagar nem alterar estados vivos de pagamento,
 * agenda ou escalonamento porque eles não pertencem a esta memória.
 */
export function mergeContactAgentMemory(current: ContactAgentMemory | null, patch: ContactAgentMemoryPatch): ContactAgentMemoryPatch {
  const mergedFacts = {
    ...(current?.facts_confirmed || {}),
    ...(patch.factsConfirmed ? normalizeMemoryFacts(patch.factsConfirmed) : {}),
  };
  const mergedObjections = patch.objections === undefined
    ? (current?.objections || [])
    : normalizeStringList([...(current?.objections || []), ...patch.objections]);
  const mergedOpenLoops = patch.openLoops === undefined
    ? (current?.open_loops || [])
    : normalizeOpenLoops(patch.openLoops);

  return {
    preferredLanguage: patch.preferredLanguage === undefined ? current?.preferred_language ?? undefined : normalizeNullableText(patch.preferredLanguage, 32),
    preferredName: patch.preferredName === undefined ? current?.preferred_name ?? undefined : normalizeNullableText(patch.preferredName, 120),
    currentIntent: patch.currentIntent === undefined ? current?.current_intent ?? undefined : normalizeNullableText(patch.currentIntent, 80),
    serviceInterest: patch.serviceInterest === undefined ? current?.service_interest ?? undefined : normalizeNullableText(patch.serviceInterest, 160),
    objections: mergedObjections,
    factsConfirmed: mergedFacts,
    openLoops: mergedOpenLoops,
    nextBestAction: patch.nextBestAction === undefined ? current?.next_best_action ?? undefined : normalizeNullableText(patch.nextBestAction, 240),
    conversationSummary: patch.conversationSummary === undefined ? current?.conversation_summary ?? undefined : normalizeNullableText(patch.conversationSummary, MAX_SUMMARY_LENGTH),
    updatedBy: patch.updatedBy || current?.updated_by || 'system',
  };
}

function assertScope(tenantId: string, phone: string): void {
  if (!tenantId?.trim()) throw new Error('tenantId é obrigatório para memória de contato.');
  if (!phone?.trim()) throw new Error('phone é obrigatório para memória de contato.');
}

export async function getContactAgentMemory(tenantId: string, phone: string): Promise<ContactAgentMemory | null> {
  assertScope(tenantId, phone);
  const db = getDb();
  const { data, error } = await db
    .from('contact_agent_memory')
    .select('*')
    .eq('tenant_id', tenantId)
    .eq('phone', phone)
    .maybeSingle();
  if (error) throw error;
  return data ? normalizeContactAgentMemory(data as unknown as Partial<ContactAgentMemory> & Record<string, unknown>) : null;
}

export async function upsertContactAgentMemory(input: { tenantId: string; phone: string; patch: ContactAgentMemoryPatch }): Promise<ContactAgentMemory> {
  assertScope(input.tenantId, input.phone);
  const current = await getContactAgentMemory(input.tenantId, input.phone);
  const merged = mergeContactAgentMemory(current, input.patch);
  const now = new Date().toISOString();
  const db = getDb();
  const payload = {
    tenant_id: input.tenantId,
    phone: input.phone,
    preferred_language: merged.preferredLanguage ?? null,
    preferred_name: merged.preferredName ?? null,
    current_intent: merged.currentIntent ?? null,
    service_interest: merged.serviceInterest ?? null,
    objections: normalizeStringList(merged.objections),
    facts_confirmed: normalizeMemoryFacts(merged.factsConfirmed),
    open_loops: normalizeOpenLoops(merged.openLoops),
    next_best_action: merged.nextBestAction ?? null,
    conversation_summary: merged.conversationSummary ?? null,
    updated_by: normalizeUpdatedBy(merged.updatedBy),
    updated_at: now,
  };
  const { data, error } = await db
    .from('contact_agent_memory')
    .upsert(payload, { onConflict: 'tenant_id,phone' })
    .select('*')
    .single();
  if (error) throw error;
  return normalizeContactAgentMemory(data as unknown as Partial<ContactAgentMemory> & Record<string, unknown>);
}
