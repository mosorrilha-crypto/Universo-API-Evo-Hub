import { randomUUID } from 'crypto';
import { getDb } from './db';

export interface AgentTurnTrace {
  id: string;
  tenant_id: string;
  phone: string;
  message_id: string | null;
  router_decision: string;
  router_confidence: number | null;
  reasoning_summary: string | null;
  context_pack_version: string;
  selected_facts: Record<string, unknown>;
  tool_summaries: string[];
  needs_human_confirmation: boolean;
  escalation_id: string | null;
  provider: string | null;
  model: string | null;
  latency_ms: number | null;
  estimated_cost_usd: number | null;
  outcome: string | null;
  created_at: string;
}

export interface RecordAgentTurnTraceInput {
  tenantId: string;
  phone: string;
  messageId?: string;
  routerDecision: string;
  routerConfidence?: number | null;
  reasoningSummary?: string | null;
  contextPackVersion: string;
  selectedFacts?: Record<string, unknown>;
  toolSummaries?: string[];
  needsHumanConfirmation: boolean;
  escalationId?: string | null;
  provider?: string | null;
  model?: string | null;
  latencyMs?: number | null;
  estimatedCostUsd?: number | null;
  outcome?: string | null;
}

const SENSITIVE_KEY = /(?:password|secret|token|authorization|credential|access[_-]?key|base64|media|audio|image|video|file|receipt|comprovante|prompt|history|message|text|content|phone|email|name|address)/i;
const SENSITIVE_VALUE = /(?:data:[^\s]+;base64|bearer\s+\S+|(?:\+?\d[\s().-]?){8,}|wamid\.|eyJ[a-zA-Z0-9_-]{10,})/i;
const MAX_STRING_LENGTH = 260;
const MAX_ARRAY_ITEMS = 8;
const MAX_OBJECT_KEYS = 16;

function normalizeText(value: unknown, maxLength = MAX_STRING_LENGTH): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (!normalized || SENSITIVE_VALUE.test(normalized)) return null;
  return normalized.slice(0, maxLength);
}

function sanitizeValue(value: unknown, depth = 0): unknown {
  if (depth > 3 || value === null || value === undefined) return undefined;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (typeof value === 'string') return normalizeText(value);
  if (Array.isArray(value)) {
    return value
      .slice(0, MAX_ARRAY_ITEMS)
      .map((item) => sanitizeValue(item, depth + 1))
      .filter((item) => item !== undefined);
  }
  if (typeof value === 'object') {
    const output: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>).slice(0, MAX_OBJECT_KEYS)) {
      if (!key || SENSITIVE_KEY.test(key)) continue;
      const safeValue = sanitizeValue(item, depth + 1);
      if (safeValue !== undefined) output[key.slice(0, 80)] = safeValue;
    }
    return output;
  }
  return undefined;
}

/** Exportada para testes: elimina payloads sensíveis antes de qualquer insert. */
export function redactTraceFacts(value: unknown): Record<string, unknown> {
  const sanitized = sanitizeValue(value);
  return sanitized && typeof sanitized === 'object' && !Array.isArray(sanitized)
    ? sanitized as Record<string, unknown>
    : {};
}

export function normalizeToolSummaries(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .slice(0, MAX_ARRAY_ITEMS)
    .map((item) => normalizeText(item, 320))
    .filter((item): item is string => !!item);
}

function assertScope(tenantId: string, phone: string): void {
  if (!tenantId?.trim()) throw new Error('tenantId é obrigatório para trace do agente.');
  if (!phone?.trim()) throw new Error('phone é obrigatório para trace do agente.');
}

function normalizeOptionalNumber(value: unknown, min = 0): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= min ? value : null;
}

function normalizeDecision(value: string): string {
  const normalized = normalizeText(value, 80);
  if (!normalized) throw new Error('routerDecision é obrigatório para trace do agente.');
  return normalized;
}

function normalizeVersion(value: string): string {
  const normalized = normalizeText(value, 80);
  if (!normalized) throw new Error('contextPackVersion é obrigatório para trace do agente.');
  return normalized;
}

export async function recordAgentTurnTrace(input: RecordAgentTurnTraceInput): Promise<AgentTurnTrace> {
  assertScope(input.tenantId, input.phone);
  const db = getDb();
  const payload = {
    id: randomUUID(),
    tenant_id: input.tenantId,
    phone: input.phone,
    message_id: normalizeText(input.messageId, 180),
    router_decision: normalizeDecision(input.routerDecision),
    router_confidence: input.routerConfidence == null ? null : Math.max(0, Math.min(1, input.routerConfidence)),
    reasoning_summary: normalizeText(input.reasoningSummary),
    context_pack_version: normalizeVersion(input.contextPackVersion),
    selected_facts: redactTraceFacts(input.selectedFacts),
    tool_summaries: normalizeToolSummaries(input.toolSummaries),
    needs_human_confirmation: !!input.needsHumanConfirmation,
    escalation_id: normalizeText(input.escalationId, 180),
    provider: normalizeText(input.provider, 80),
    model: normalizeText(input.model, 120),
    latency_ms: normalizeOptionalNumber(input.latencyMs),
    estimated_cost_usd: normalizeOptionalNumber(input.estimatedCostUsd),
    outcome: normalizeText(input.outcome, 120),
  };

  const query = payload.message_id
    ? db.from('agent_turn_traces').upsert(payload, { onConflict: 'tenant_id,message_id' })
    : db.from('agent_turn_traces').insert(payload);
  const { data, error } = await query.select('*').single();
  if (error) throw error;
  return data as AgentTurnTrace;
}

export async function listAgentTurnTraces(tenantId: string, phone: string, limit = 50): Promise<AgentTurnTrace[]> {
  assertScope(tenantId, phone);
  const db = getDb();
  const { data, error } = await db
    .from('agent_turn_traces')
    .select('*')
    .eq('tenant_id', tenantId)
    .eq('phone', phone)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return ((data || []) as AgentTurnTrace[]).slice(0, Math.max(1, Math.min(limit, 200)));
}
