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
  /** TASK-0444: preenchidos por `updateAgentTurnTraceOutcome`, sempre DEPOIS do insert acima — nunca no mesmo write (ver comentário da função). */
  output_message_ids: string[];
  review_status: string | null;
  final_send_status: string | null;
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

/**
 * TASK-0444 (achado real durante a auditoria de rastreabilidade, corrigido
 * depois de uma primeira leitura incompleta): `message_id` usava
 * `normalizeText`, cujo `SENSITIVE_VALUE` descarta de propósito qualquer
 * string contendo "wamid." OU uma sequência de 8+ dígitos seguidos (pensado
 * pra pegar número de telefone) — pra impedir que um id VAZASSE dentro de um
 * campo de texto livre (ex: `reasoningSummary`), não pra rejeitar o próprio
 * campo de id. Primeira verificação (consulta somente leitura, tenant
 * Monique — Evolution) olhou só o formato "wamid." (canal Meta) e achou 0 de
 * 929 traces — mas a Monique usa o canal Evolution como principal, não Meta,
 * então essa amostra não provava nada sobre o impacto real nela. Testado
 * depois com os IDs reais dos dois canais: o formato hexadecimal do
 * Evolution (ex: "AC517A86E4A25221676BD4DDF5004169", que contém a sequência
 * "25221676", 8 dígitos seguidos) e o id interno gerado pelo próprio código
 * pra mensagens enviadas (`wa-{timestamp}-{sufixo}`, timestamp é só dígitos)
 * também batem no filtro — o bug não era específico do Meta, quebrava a
 * correlação por mensagem nos dois canais, silenciosamente, desde que esta
 * tabela existe (TASK cria `agent_turn_traces`, 22/08/2026). `message_id`/
 * `escalation_id` são campos de IDENTIFICADOR, não texto livre — usam só
 * corte de tamanho, sem a checagem de conteúdo sensível (que continua
 * valendo pra `reasoning_summary`/`provider`/`model`, onde faz sentido como
 * defesa contra um id vazando pra dentro de texto).
 */
function normalizeIdentifier(value: unknown, maxLength = MAX_STRING_LENGTH): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.replace(/\s+/g, ' ').trim();
  return normalized ? normalized.slice(0, maxLength) : null;
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

/**
 * TASK-0444: diferente de `normalizeToolSummaries`, NÃO usa `normalizeText`
 * — o `SENSITIVE_VALUE` dele descarta de propósito qualquer string contendo
 * "wamid." (tratado como dado sensível em outros campos), mas aqui é
 * exatamente esse tipo de id que precisamos guardar pra correlação
 * (rastreabilidade é o objetivo desta coluna, não um efeito colateral a
 * redigir). Ids de mensagem não são segredo — só limita tamanho/quantidade.
 */
function sanitizeMessageIds(value: string[]): string[] {
  return value
    .slice(0, MAX_ARRAY_ITEMS)
    .map((item) => normalizeIdentifier(item, 180))
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
    message_id: normalizeIdentifier(input.messageId, 180),
    router_decision: normalizeDecision(input.routerDecision),
    router_confidence: input.routerConfidence == null ? null : Math.max(0, Math.min(1, input.routerConfidence)),
    reasoning_summary: normalizeText(input.reasoningSummary),
    context_pack_version: normalizeVersion(input.contextPackVersion),
    selected_facts: redactTraceFacts(input.selectedFacts),
    tool_summaries: normalizeToolSummaries(input.toolSummaries),
    needs_human_confirmation: !!input.needsHumanConfirmation,
    escalation_id: normalizeIdentifier(input.escalationId, 180),
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

export type ReviewStatus = 'blocked' | 'approved' | 'approved_with_correction';
export type FinalSendStatus = 'sent' | 'not_sent_blocked' | 'not_sent_calendar_error' | 'send_failed';

export interface UpdateAgentTurnTraceOutcomeInput {
  tenantId: string;
  messageId: string;
  reviewStatus?: ReviewStatus;
  finalSendStatus?: FinalSendStatus;
  outputMessageIds?: string[];
}

/**
 * TASK-0444 (achado real de auditoria): `recordAgentTurnTrace` roda ANTES do
 * revisor pré-envio e do envio de verdade (dentro de `generateAutoReplyForText`),
 * então não tem como saber ali se a resposta foi bloqueada, aprovada com
 * correção, ou efetivamente entregue. Esta função faz um UPDATE parcial —
 * nunca um upsert do payload inteiro — no mesmo registro (chave única
 * `tenant_id, message_id`, já existente desde `0042_agent_context_memory`),
 * chamada por `webhooks.ts` depois que o resultado real é conhecido. Sem
 * `messageId`, não há como casar com um registro único — o chamador deve
 * pular a chamada nesse caso (nunca passar string vazia como coringa).
 * Não lança se nenhuma linha bater (ex: o insert original falhou/foi
 * suprimido) — mesma filosofia de "nunca bloquear o envio real por causa de
 * telemetria" já usada no `.catch()` do `recordAgentTurnTrace` em autoReply.ts.
 */
export async function updateAgentTurnTraceOutcome(input: UpdateAgentTurnTraceOutcomeInput): Promise<void> {
  const messageId = normalizeIdentifier(input.messageId, 180);
  if (!input.tenantId?.trim() || !messageId) return;
  const db = getDb();
  const update: Record<string, unknown> = {};
  if (input.reviewStatus) update.review_status = input.reviewStatus;
  if (input.finalSendStatus) update.final_send_status = input.finalSendStatus;
  if (input.outputMessageIds) update.output_message_ids = sanitizeMessageIds(input.outputMessageIds);
  if (!Object.keys(update).length) return;
  const { error } = await db
    .from('agent_turn_traces')
    .update(update)
    .eq('tenant_id', input.tenantId)
    .eq('message_id', messageId);
  if (error) throw error;
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
