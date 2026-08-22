import { randomUUID } from 'crypto';
import { getDb } from './db';

export type QualityReviewKind = 'ai_suggestion' | 'bug' | 'operator_idea' | 'knowledge';
export type QualityReviewStatus = 'pending' | 'approved' | 'testing' | 'published' | 'rejected' | 'resolved' | 'reopened';

export interface QualityReview {
  id: string;
  tenant_id: string;
  kind: QualityReviewKind;
  status: QualityReviewStatus;
  title: string;
  description: string;
  context: Record<string, unknown>;
  confidence?: number | null;
  original_value?: string | null;
  corrected_value?: string | null;
  created_by?: string | null;
  reviewed_by?: string | null;
  review_note?: string | null;
  created_at: string;
  updated_at: string;
}

export interface QualityAuditEvent {
  id: string;
  tenant_id: string;
  event_type: string;
  source: string;
  entity_type?: string | null;
  entity_id?: string | null;
  conversation_phone?: string | null;
  actor_id?: string | null;
  payload: Record<string, unknown>;
  created_at: string;
}

const VALID_KINDS: QualityReviewKind[] = ['ai_suggestion', 'bug', 'operator_idea', 'knowledge'];
const VALID_STATUSES: QualityReviewStatus[] = ['pending', 'approved', 'testing', 'published', 'rejected', 'resolved', 'reopened'];

function assertKind(kind: string): asserts kind is QualityReviewKind {
  if (!VALID_KINDS.includes(kind as QualityReviewKind)) throw new Error('Tipo de revisão inválido.');
}

function assertStatus(status: string): asserts status is QualityReviewStatus {
  if (!VALID_STATUSES.includes(status as QualityReviewStatus)) throw new Error('Status de revisão inválido.');
}

function normalizeContext(context: unknown): Record<string, unknown> {
  if (!context || typeof context !== 'object' || Array.isArray(context)) return {};
  return context as Record<string, unknown>;
}

export async function listQualityReviews(tenantId: string, options: { kind?: QualityReviewKind; status?: QualityReviewStatus; limit?: number } = {}): Promise<QualityReview[]> {
  const db = getDb();
  let query = db
    .from('quality_reviews')
    .select('*')
    .eq('tenant_id', tenantId)
    .order('created_at', { ascending: false });
  if (options.kind) query = query.eq('kind', options.kind);
  if (options.status) query = query.eq('status', options.status);
  const { data, error } = await query;
  if (error) throw error;
  const limit = Math.max(1, Math.min(options.limit ?? 200, 500));
  return ((data || []) as QualityReview[]).slice(0, limit);
}

export async function listQualityAuditEvents(tenantId: string, limit = 200): Promise<QualityAuditEvent[]> {
  const db = getDb();
  const { data, error } = await db
    .from('quality_audit_events')
    .select('*')
    .eq('tenant_id', tenantId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return ((data || []) as QualityAuditEvent[]).slice(0, Math.max(1, Math.min(limit, 500)));
}

export async function createQualityReview(input: {
  tenantId: string;
  kind: QualityReviewKind;
  title: string;
  description: string;
  context?: Record<string, unknown>;
  confidence?: number | null;
  originalValue?: string | null;
  correctedValue?: string | null;
  createdBy?: string | null;
  status?: QualityReviewStatus;
}): Promise<QualityReview> {
  assertKind(input.kind);
  const title = input.title.trim();
  const description = input.description.trim();
  if (!title || !description) throw new Error('Título e descrição são obrigatórios.');
  const status = input.status || 'pending';
  assertStatus(status);
  const db = getDb();
  const payload = {
    id: randomUUID(),
    tenant_id: input.tenantId,
    kind: input.kind,
    status,
    title,
    description,
    context: normalizeContext(input.context),
    confidence: typeof input.confidence === 'number' ? Math.max(0, Math.min(1, input.confidence)) : null,
    original_value: input.originalValue ?? null,
    corrected_value: input.correctedValue ?? null,
    created_by: input.createdBy ?? null,
  };
  const { data, error } = await db.from('quality_reviews').insert(payload).select('*').single();
  if (error) throw error;
  return data as QualityReview;
}

export async function updateQualityReview(input: {
  tenantId: string;
  reviewId: string;
  status?: QualityReviewStatus;
  reviewNote?: string | null;
  correctedValue?: string | null;
  reviewedBy?: string | null;
}): Promise<QualityReview | null> {
  if (input.status) assertStatus(input.status);
  const patch: Record<string, unknown> = {};
  if (input.status) patch.status = input.status;
  if (input.reviewNote !== undefined) patch.review_note = input.reviewNote;
  if (input.correctedValue !== undefined) patch.corrected_value = input.correctedValue;
  if (input.reviewedBy !== undefined) patch.reviewed_by = input.reviewedBy;
  if (!Object.keys(patch).length) return null;
  patch.updated_at = new Date().toISOString();
  const db = getDb();
  const { data, error } = await db
    .from('quality_reviews')
    .update(patch)
    .eq('tenant_id', input.tenantId)
    .eq('id', input.reviewId)
    .select('*')
    .maybeSingle();
  if (error) throw error;
  return (data || null) as QualityReview | null;
}

export async function recordQualityAuditEvent(input: {
  tenantId: string;
  eventType: string;
  source: string;
  entityType?: string;
  entityId?: string;
  conversationPhone?: string;
  actorId?: string;
  payload?: Record<string, unknown>;
}): Promise<QualityAuditEvent> {
  const db = getDb();
  const { data, error } = await db.from('quality_audit_events').insert({
    id: randomUUID(),
    tenant_id: input.tenantId,
    event_type: input.eventType,
    source: input.source,
    entity_type: input.entityType ?? null,
    entity_id: input.entityId ?? null,
    conversation_phone: input.conversationPhone ?? null,
    actor_id: input.actorId ?? null,
    payload: normalizeContext(input.payload),
  }).select('*').single();
  if (error) throw error;
  return data as QualityAuditEvent;
}

export interface QualityRecommendation {
  id: string;
  title: string;
  description: string;
  evidenceCount: number;
  action: 'review' | 'test' | 'group';
  kind: QualityReviewKind;
}

export function deriveQualityRecommendations(reviews: QualityReview[]): QualityRecommendation[] {
  const recommendations: QualityRecommendation[] = [];
  const correctedSuggestions = reviews.filter((review) => review.kind === 'ai_suggestion' && review.context?.decision === 'corrected');
  if (correctedSuggestions.length >= 3) {
    recommendations.push({
      id: 'repeated-corrections',
      title: 'Revisar sugestões corrigidas com frequência',
      description: 'A IA está recebendo correções semelhantes. Compare os exemplos antes de publicar uma nova regra.',
      evidenceCount: correctedSuggestions.length,
      action: 'review',
      kind: 'ai_suggestion',
    });
  }

  const openBugs = reviews.filter((review) => review.kind === 'bug' && !['resolved', 'rejected'].includes(review.status));
  if (openBugs.length >= 3) {
    recommendations.push({
      id: 'open-bugs',
      title: 'Agrupar incidentes recorrentes',
      description: 'Há vários bugs em aberto. Agrupe relatos semelhantes para priorizar a correção pela causa raiz.',
      evidenceCount: openBugs.length,
      action: 'group',
      kind: 'bug',
    });
  }

  const pendingIdeas = reviews.filter((review) => review.kind === 'operator_idea' && review.status === 'pending');
  if (pendingIdeas.length > 0) {
    recommendations.push({
      id: 'pending-ideas',
      title: 'Revisar as melhorias sugeridas pelos operadores',
      description: 'Transforme as ideias mais recorrentes em teste controlado ou tarefa de produto.',
      evidenceCount: pendingIdeas.length,
      action: 'review',
      kind: 'operator_idea',
    });
  }

  return recommendations;
}
