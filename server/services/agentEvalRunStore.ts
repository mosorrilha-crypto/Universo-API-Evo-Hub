import { getDb } from './db';

/**
 * TASK-0208 — status de uma rodada de avaliação automática em background
 * (ver agentEvalService.runAgentEvaluation). Achados de verdade ficam em
 * quality_reviews (kind=bug, context.source=synthetic_eval); esta tabela
 * só existe pra a UI saber "está rodando"/"terminou, X de Y passaram" sem
 * precisar manter a requisição HTTP aberta por minutos.
 */
export type AgentEvalRunStatus = 'running' | 'completed' | 'failed';

export interface AgentEvalRun {
  id: string;
  tenantId: string;
  status: AgentEvalRunStatus;
  requestedCount: number;
  completedCount: number;
  passCount: number;
  failCount: number;
  repeatedPhraseCount: number;
  error?: string | null;
  requestedBy?: string | null;
  startedAt: string;
  finishedAt?: string | null;
}

type AgentEvalRunRow = {
  id: string;
  tenant_id: string;
  status: AgentEvalRunStatus;
  requested_count: number;
  completed_count: number;
  pass_count: number;
  fail_count: number;
  repeated_phrase_count: number;
  error: string | null;
  requested_by: string | null;
  started_at: string;
  finished_at: string | null;
};

function toRun(row: AgentEvalRunRow): AgentEvalRun {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    status: row.status,
    requestedCount: row.requested_count,
    completedCount: row.completed_count,
    passCount: row.pass_count,
    failCount: row.fail_count,
    repeatedPhraseCount: row.repeated_phrase_count,
    error: row.error || undefined,
    requestedBy: row.requested_by || undefined,
    startedAt: row.started_at,
    finishedAt: row.finished_at || undefined,
  };
}

export async function createAgentEvalRun(input: { tenantId: string; requestedCount: number; requestedBy?: string | null }): Promise<AgentEvalRun> {
  const { data, error } = await getDb().from('agent_eval_runs').insert({
    tenant_id: input.tenantId,
    status: 'running',
    requested_count: input.requestedCount,
    completed_count: 0,
    pass_count: 0,
    fail_count: 0,
    repeated_phrase_count: 0,
    requested_by: input.requestedBy || null,
    started_at: new Date().toISOString(),
  }).select('*').single();
  if (error) throw error;
  return toRun(data as AgentEvalRunRow);
}

export async function updateAgentEvalRunProgress(runId: string, progress: { completedCount: number; passCount: number; failCount: number }): Promise<void> {
  const { error } = await getDb().from('agent_eval_runs').update({
    completed_count: progress.completedCount,
    pass_count: progress.passCount,
    fail_count: progress.failCount,
  }).eq('id', runId);
  if (error) throw error;
}

export async function finishAgentEvalRun(runId: string, outcome: { status: 'completed' | 'failed'; repeatedPhraseCount?: number; error?: string }): Promise<void> {
  const { error } = await getDb().from('agent_eval_runs').update({
    status: outcome.status,
    repeated_phrase_count: outcome.repeatedPhraseCount ?? 0,
    error: outcome.error ?? null,
    finished_at: new Date().toISOString(),
  }).eq('id', runId);
  if (error) throw error;
}

export async function listAgentEvalRuns(tenantId: string, limit = 20): Promise<AgentEvalRun[]> {
  const { data, error } = await getDb().from('agent_eval_runs')
    .select('*')
    .eq('tenant_id', tenantId)
    .order('started_at', { ascending: false })
    .limit(Math.max(1, Math.min(limit, 50)));
  if (error) throw error;
  return ((data || []) as AgentEvalRunRow[]).map(toRun);
}
