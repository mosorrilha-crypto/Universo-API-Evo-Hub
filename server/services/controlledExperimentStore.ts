import { randomUUID } from 'crypto';
import { getDb } from './db';

export type ControlledExperimentStatus = 'draft' | 'ready' | 'running' | 'paused' | 'completed' | 'rejected';
export type ControlledExperimentRoute = 'triagem' | 'faq' | 'reclamacao';

export interface ControlledExperiment {
  id: string;
  tenant_id: string;
  quality_review_id: string;
  status: ControlledExperimentStatus;
  hypothesis: string;
  variation_summary: string;
  scope_routes: ControlledExperimentRoute[];
  sample_limit: number;
  success_criteria: string[];
  stop_conditions: string[];
  outcome_summary: string | null;
  decision_note: string | null;
  created_by: string | null;
  activated_by: string | null;
  decided_by: string | null;
  started_at: string | null;
  ended_at: string | null;
  created_at: string;
  updated_at: string;
}

const VALID_STATUS = new Set<ControlledExperimentStatus>(['draft', 'ready', 'running', 'paused', 'completed', 'rejected']);
const VALID_ROUTES = new Set<ControlledExperimentRoute>(['triagem', 'faq', 'reclamacao']);
const HARD_STOP_CONDITIONS = [
  'Sinal de pagamento ou confirmação de agenda',
  'Escalonamento humano, incidente sensível ou risco de segurança',
  'Aumento de respostas bloqueadas, inseguras ou incorretas',
] as const;
const TRANSITIONS: Record<ControlledExperimentStatus, ControlledExperimentStatus[]> = {
  draft: ['ready', 'rejected'],
  ready: ['running', 'paused', 'rejected'],
  running: ['paused', 'completed'],
  paused: ['ready', 'completed', 'rejected'],
  completed: [],
  rejected: [],
};

function assertTenant(tenantId: string): void {
  if (!tenantId?.trim()) throw new Error('tenantId é obrigatório para experimentos controlados.');
}

function text(value: unknown, field: string, maxLength: number, required = true): string | null {
  if (value == null && !required) return null;
  if (typeof value !== 'string') throw new Error(`${field} inválido.`);
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (required && !normalized) throw new Error(`${field} é obrigatório.`);
  return normalized ? normalized.slice(0, maxLength) : null;
}

function stringList(value: unknown, field: string, min: number, max: number): string[] {
  if (!Array.isArray(value)) throw new Error(`${field} deve ser uma lista.`);
  const normalized = Array.from(new Set(value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .map((item) => item.slice(0, 220))))
    .slice(0, max);
  if (normalized.length < min) throw new Error(`${field} exige ao menos ${min} item(ns).`);
  return normalized;
}

function routes(value: unknown): ControlledExperimentRoute[] {
  if (!Array.isArray(value)) throw new Error('Escopo de rotas deve ser uma lista.');
  const normalized = Array.from(new Set(value.filter((route): route is ControlledExperimentRoute => typeof route === 'string' && VALID_ROUTES.has(route as ControlledExperimentRoute))));
  if (!normalized.length) throw new Error('Selecione ao menos uma rota permitida: triagem, FAQ ou reclamação.');
  return normalized;
}

function sampleLimit(value: unknown): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 25) throw new Error('A amostra deve estar entre 1 e 25 conversas elegíveis.');
  return parsed;
}

function normalizeStatus(value: unknown): ControlledExperimentStatus {
  if (typeof value !== 'string' || !VALID_STATUS.has(value as ControlledExperimentStatus)) throw new Error('Status de experimento inválido.');
  return value as ControlledExperimentStatus;
}

function normalizeRow(row: Record<string, unknown>): ControlledExperiment {
  return {
    id: typeof row.id === 'string' ? row.id : '',
    tenant_id: typeof row.tenant_id === 'string' ? row.tenant_id : '',
    quality_review_id: typeof row.quality_review_id === 'string' ? row.quality_review_id : '',
    status: typeof row.status === 'string' && VALID_STATUS.has(row.status as ControlledExperimentStatus) ? row.status as ControlledExperimentStatus : 'draft',
    hypothesis: typeof row.hypothesis === 'string' ? row.hypothesis : '',
    variation_summary: typeof row.variation_summary === 'string' ? row.variation_summary : '',
    scope_routes: Array.isArray(row.scope_routes) ? row.scope_routes.filter((route): route is ControlledExperimentRoute => typeof route === 'string' && VALID_ROUTES.has(route as ControlledExperimentRoute)) : [],
    sample_limit: typeof row.sample_limit === 'number' ? row.sample_limit : 1,
    success_criteria: Array.isArray(row.success_criteria) ? row.success_criteria.filter((item): item is string => typeof item === 'string') : [],
    stop_conditions: Array.isArray(row.stop_conditions) ? row.stop_conditions.filter((item): item is string => typeof item === 'string') : [],
    outcome_summary: typeof row.outcome_summary === 'string' ? row.outcome_summary : null,
    decision_note: typeof row.decision_note === 'string' ? row.decision_note : null,
    created_by: typeof row.created_by === 'string' ? row.created_by : null,
    activated_by: typeof row.activated_by === 'string' ? row.activated_by : null,
    decided_by: typeof row.decided_by === 'string' ? row.decided_by : null,
    started_at: typeof row.started_at === 'string' ? row.started_at : null,
    ended_at: typeof row.ended_at === 'string' ? row.ended_at : null,
    created_at: typeof row.created_at === 'string' ? row.created_at : new Date(0).toISOString(),
    updated_at: typeof row.updated_at === 'string' ? row.updated_at : new Date(0).toISOString(),
  };
}

export function getMandatoryStopConditions(): readonly string[] {
  return HARD_STOP_CONDITIONS;
}

export async function listControlledExperiments(tenantId: string): Promise<ControlledExperiment[]> {
  assertTenant(tenantId);
  const { data, error } = await getDb()
    .from('controlled_quality_experiments')
    .select('*')
    .eq('tenant_id', tenantId)
    .order('updated_at', { ascending: false });
  if (error) throw error;
  return (data || []).map((row) => normalizeRow(row as Record<string, unknown>));
}

export async function createControlledExperiment(input: {
  tenantId: string;
  qualityReviewId: string;
  hypothesis: unknown;
  variationSummary: unknown;
  scopeRoutes: unknown;
  sampleLimit: unknown;
  successCriteria: unknown;
  stopConditions: unknown;
  createdBy?: string | null;
}): Promise<ControlledExperiment> {
  assertTenant(input.tenantId);
  if (typeof input.qualityReviewId !== 'string' || !input.qualityReviewId.trim()) throw new Error('O item de Qualidade é obrigatório.');
  const providedStops = stringList(input.stopConditions, 'Condições de parada', 0, 8);
  const mandatoryStops = HARD_STOP_CONDITIONS.filter((condition) => !providedStops.includes(condition));
  if (mandatoryStops.length) throw new Error('As condições de parada obrigatórias não podem ser removidas.');
  const payload = {
    id: randomUUID(),
    tenant_id: input.tenantId,
    quality_review_id: input.qualityReviewId,
    status: 'draft' as const,
    hypothesis: text(input.hypothesis, 'Hipótese', 600)!,
    variation_summary: text(input.variationSummary, 'Resumo da variação', 800)!,
    scope_routes: routes(input.scopeRoutes),
    sample_limit: sampleLimit(input.sampleLimit),
    success_criteria: stringList(input.successCriteria, 'Critérios de sucesso', 1, 6),
    stop_conditions: providedStops,
    created_by: input.createdBy || null,
  };
  const { data, error } = await getDb().from('controlled_quality_experiments').insert(payload).select('*').single();
  if (error) throw error;
  return normalizeRow(data as Record<string, unknown>);
}

export async function transitionControlledExperiment(input: {
  tenantId: string;
  experimentId: string;
  status: ControlledExperimentStatus;
  decisionNote?: unknown;
  outcomeSummary?: unknown;
  actorId?: string | null;
}): Promise<ControlledExperiment | null> {
  assertTenant(input.tenantId);
  const targetStatus = normalizeStatus(input.status);
  const existing = (await listControlledExperiments(input.tenantId)).find((experiment) => experiment.id === input.experimentId);
  if (!existing) return null;
  if (!TRANSITIONS[existing.status].includes(targetStatus)) throw new Error(`Não é possível mudar de ${existing.status} para ${targetStatus}.`);
  const now = new Date().toISOString();
  const patch: Record<string, unknown> = {
    status: targetStatus,
    decision_note: text(input.decisionNote, 'Nota da decisão', 600, false),
    updated_at: now,
    decided_by: input.actorId || null,
  };
  if (targetStatus === 'ready' || targetStatus === 'running') patch.activated_by = input.actorId || null;
  if (targetStatus === 'running') patch.started_at = now;
  if (targetStatus === 'completed' || targetStatus === 'rejected') {
    patch.ended_at = now;
    patch.outcome_summary = text(input.outcomeSummary, 'Resumo do resultado', 800, targetStatus === 'completed');
  }
  const { data, error } = await getDb()
    .from('controlled_quality_experiments')
    .update(patch)
    .eq('tenant_id', input.tenantId)
    .eq('id', input.experimentId)
    .select('*')
    .maybeSingle();
  if (error) throw error;
  return data ? normalizeRow(data as Record<string, unknown>) : null;
}
