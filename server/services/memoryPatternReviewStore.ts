import { randomUUID } from 'crypto';
import { getDb } from './db';

export const MEMORY_PATTERN_KEYS = ['preferredLanguage', 'preferredName', 'currentIntent', 'serviceInterest', 'objections', 'nextBestAction'] as const;
export type MemoryPatternKey = typeof MEMORY_PATTERN_KEYS[number];
export type MemoryPatternReviewStatus = 'pending' | 'observed' | 'knowledge_draft' | 'prompt_test' | 'dismissed';
export type MemoryPatternAgentRoute = 'triagem' | 'faq' | 'agendamento' | 'reclamacao' | 'unknown';

export interface MemoryPatternReview {
  id: string;
  tenant_id: string;
  pattern_key: MemoryPatternKey;
  evidence_count: number;
  agent_routes: MemoryPatternAgentRoute[];
  status: MemoryPatternReviewStatus;
  review_note: string | null;
  linked_quality_review_id: string | null;
  created_by: string | null;
  decided_by: string | null;
  created_at: string;
  updated_at: string;
}

const VALID_STATUS = new Set<MemoryPatternReviewStatus>(['pending', 'observed', 'knowledge_draft', 'prompt_test', 'dismissed']);
const VALID_ROUTE = new Set<MemoryPatternAgentRoute>(['triagem', 'faq', 'agendamento', 'reclamacao', 'unknown']);

function assertScope(tenantId: string): void {
  if (!tenantId?.trim()) throw new Error('tenantId é obrigatório para a fila de padrões.');
}

export function isMemoryPatternKey(value: unknown): value is MemoryPatternKey {
  return typeof value === 'string' && (MEMORY_PATTERN_KEYS as readonly string[]).includes(value);
}

function normalizeRoutes(value: unknown): MemoryPatternAgentRoute[] {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(value.filter((route): route is MemoryPatternAgentRoute => typeof route === 'string' && VALID_ROUTE.has(route as MemoryPatternAgentRoute)))).slice(0, 5);
}

function normalizeNote(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value !== 'string') throw new Error('Nota de revisão inválida.');
  const normalized = value.replace(/\s+/g, ' ').trim();
  return normalized ? normalized.slice(0, 600) : null;
}

function normalizeStatus(value: unknown): MemoryPatternReviewStatus {
  if (typeof value !== 'string' || !VALID_STATUS.has(value as MemoryPatternReviewStatus)) {
    throw new Error('Decisão de padrão inválida.');
  }
  return value as MemoryPatternReviewStatus;
}

function normalizeRow(row: Record<string, unknown>): MemoryPatternReview {
  const patternKey = isMemoryPatternKey(row.pattern_key) ? row.pattern_key : 'preferredName';
  return {
    id: typeof row.id === 'string' ? row.id : '',
    tenant_id: typeof row.tenant_id === 'string' ? row.tenant_id : '',
    pattern_key: patternKey,
    evidence_count: typeof row.evidence_count === 'number' && Number.isFinite(row.evidence_count) ? Math.max(0, Math.floor(row.evidence_count)) : 0,
    agent_routes: normalizeRoutes(row.agent_routes),
    status: typeof row.status === 'string' && VALID_STATUS.has(row.status as MemoryPatternReviewStatus) ? row.status as MemoryPatternReviewStatus : 'pending',
    review_note: normalizeNote(row.review_note),
    linked_quality_review_id: typeof row.linked_quality_review_id === 'string' ? row.linked_quality_review_id : null,
    created_by: typeof row.created_by === 'string' ? row.created_by : null,
    decided_by: typeof row.decided_by === 'string' ? row.decided_by : null,
    created_at: typeof row.created_at === 'string' ? row.created_at : new Date(0).toISOString(),
    updated_at: typeof row.updated_at === 'string' ? row.updated_at : new Date(0).toISOString(),
  };
}

export async function listMemoryPatternReviews(tenantId: string): Promise<MemoryPatternReview[]> {
  assertScope(tenantId);
  const { data, error } = await getDb()
    .from('memory_pattern_reviews')
    .select('*')
    .eq('tenant_id', tenantId)
    .order('updated_at', { ascending: false });
  if (error) throw error;
  return (data || []).map((row) => normalizeRow(row as Record<string, unknown>));
}

async function getMemoryPatternReviewByKey(tenantId: string, patternKey: MemoryPatternKey): Promise<MemoryPatternReview | null> {
  const { data, error } = await getDb()
    .from('memory_pattern_reviews')
    .select('*')
    .eq('tenant_id', tenantId)
    .eq('pattern_key', patternKey)
    .maybeSingle();
  if (error) throw error;
  return data ? normalizeRow(data as Record<string, unknown>) : null;
}

/**
 * Inclui ou atualiza candidatos com evidência repetida. Isto não decide nem
 * aplica nenhuma mudança ao agente: só materializa a fila que o admin verá.
 */
export async function syncMemoryPatternReviewCandidates(input: {
  tenantId: string;
  candidates: Array<{ field: string; count: number }>;
  agentRoutes: MemoryPatternAgentRoute[];
  createdBy?: string | null;
}): Promise<MemoryPatternReview[]> {
  assertScope(input.tenantId);
  const result: MemoryPatternReview[] = [];
  for (const candidate of input.candidates) {
    if (!isMemoryPatternKey(candidate.field) || !Number.isFinite(candidate.count) || candidate.count < 3) continue;
    const current = await getMemoryPatternReviewByKey(input.tenantId, candidate.field);
    const payload = {
      id: current?.id || randomUUID(),
      tenant_id: input.tenantId,
      pattern_key: candidate.field,
      evidence_count: Math.floor(candidate.count),
      agent_routes: normalizeRoutes(input.agentRoutes),
      status: current?.status || 'pending',
      review_note: current?.review_note || null,
      linked_quality_review_id: current?.linked_quality_review_id || null,
      created_by: current?.created_by || input.createdBy || null,
      decided_by: current?.decided_by || null,
      updated_at: new Date().toISOString(),
    };
    const { data, error } = await getDb()
      .from('memory_pattern_reviews')
      .upsert(payload, { onConflict: 'tenant_id,pattern_key' })
      .select('*')
      .single();
    if (error) throw error;
    result.push(normalizeRow(data as Record<string, unknown>));
  }
  return result;
}

export async function decideMemoryPatternReview(input: {
  tenantId: string;
  reviewId: string;
  status: MemoryPatternReviewStatus;
  reviewNote?: unknown;
  decidedBy?: string | null;
  linkedQualityReviewId?: string | null;
}): Promise<MemoryPatternReview | null> {
  assertScope(input.tenantId);
  const status = normalizeStatus(input.status);
  const patch: Record<string, unknown> = {
    status,
    decided_by: input.decidedBy || null,
    updated_at: new Date().toISOString(),
  };
  if (input.reviewNote !== undefined) patch.review_note = normalizeNote(input.reviewNote);
  if (input.linkedQualityReviewId !== undefined) patch.linked_quality_review_id = input.linkedQualityReviewId;
  const { data, error } = await getDb()
    .from('memory_pattern_reviews')
    .update(patch)
    .eq('tenant_id', input.tenantId)
    .eq('id', input.reviewId)
    .select('*')
    .maybeSingle();
  if (error) throw error;
  return data ? normalizeRow(data as Record<string, unknown>) : null;
}
