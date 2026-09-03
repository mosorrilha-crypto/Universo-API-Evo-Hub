import { getDb } from './db';

/**
 * TASK-0249 — pedido direto do dono do produto: poder ver a lista completa
 * de perguntas sintéticas geradas numa rodada, COM as respostas — inclusive
 * os casos que PASSARAM, não só os que viram achado em quality_reviews. Ver
 * migração 0076_agent_eval_run_cases.sql e o achado de que `onCaseResult`
 * (agentEvalService.runAgentEvaluation) já calculava tudo isso, mas a rota
 * do painel nunca conectava o callback a lugar nenhum.
 */
export interface AgentEvalRunCase {
  id: string;
  runId: string;
  category: string;
  question: string;
  history?: { sender: 'lead' | 'agent'; text: string }[];
  agent?: string;
  bubbles?: string[];
  passed: boolean;
  safetyApproved?: boolean;
  safetyReason?: string;
  qualityIssues?: string[];
  suggestedFix?: string;
  error?: string;
  createdAt: string;
}

type AgentEvalRunCaseRow = {
  id: string;
  run_id: string;
  category: string;
  question: string;
  history: unknown;
  agent: string | null;
  bubbles: unknown;
  passed: boolean;
  safety_approved: boolean | null;
  safety_reason: string | null;
  quality_issues: unknown;
  suggested_fix: string | null;
  error: string | null;
  created_at: string;
};

function toCase(row: AgentEvalRunCaseRow): AgentEvalRunCase {
  return {
    id: row.id,
    runId: row.run_id,
    category: row.category,
    question: row.question,
    history: Array.isArray(row.history) ? (row.history as AgentEvalRunCase['history']) : undefined,
    agent: row.agent || undefined,
    bubbles: Array.isArray(row.bubbles) ? (row.bubbles as string[]) : undefined,
    passed: row.passed,
    safetyApproved: row.safety_approved ?? undefined,
    safetyReason: row.safety_reason || undefined,
    qualityIssues: Array.isArray(row.quality_issues) ? (row.quality_issues as string[]) : undefined,
    suggestedFix: row.suggested_fix || undefined,
    error: row.error || undefined,
    createdAt: row.created_at,
  };
}

export async function recordAgentEvalRunCase(input: {
  runId: string;
  tenantId: string;
  category: string;
  question: string;
  history?: { sender: 'lead' | 'agent'; text: string }[];
  agent?: string;
  bubbles?: string[];
  passed: boolean;
  safetyApproved?: boolean;
  safetyReason?: string;
  qualityIssues?: string[];
  suggestedFix?: string;
  error?: string;
}): Promise<void> {
  const { error } = await getDb().from('agent_eval_run_cases').insert({
    run_id: input.runId,
    tenant_id: input.tenantId,
    category: input.category,
    question: input.question,
    history: input.history || null,
    agent: input.agent || null,
    bubbles: input.bubbles || null,
    passed: input.passed,
    safety_approved: input.safetyApproved ?? null,
    safety_reason: input.safetyReason || null,
    quality_issues: input.qualityIssues || null,
    suggested_fix: input.suggestedFix || null,
    error: input.error || null,
  });
  if (error) throw error;
}

export async function listAgentEvalRunCases(tenantId: string, runId: string): Promise<AgentEvalRunCase[]> {
  const { data, error } = await getDb()
    .from('agent_eval_run_cases')
    .select('*')
    .eq('tenant_id', tenantId)
    .eq('run_id', runId)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return ((data || []) as AgentEvalRunCaseRow[]).map(toCase);
}
