import { getDb } from './db';
import type { ControlledExperiment } from './controlledExperimentStore';

export type ControlledExperimentResultAvailability = 'not_started' | 'insufficient_data' | 'available';
export type ControlledExperimentMetricKey = 'human_corrections' | 'escalations' | 'blocked_responses';

export interface ControlledExperimentMetricResult {
  key: ControlledExperimentMetricKey;
  label: string;
  before: number;
  after: number;
  delta: number;
  interpretation: 'improved' | 'worsened' | 'stable';
}

export interface ControlledExperimentResult {
  experimentId: string;
  availability: ControlledExperimentResultAvailability;
  baselineStart: string | null;
  baselineEnd: string | null;
  observationStart: string | null;
  observationEnd: string | null;
  windowHours: number;
  metrics: ControlledExperimentMetricResult[];
  limitations: string[];
}

const MIN_WINDOW_MS = 60 * 60 * 1000;
const MAX_WINDOW_MS = 14 * 24 * 60 * 60 * 1000;

function dateIso(value: string | null | undefined): string | null {
  if (!value || Number.isNaN(new Date(value).getTime())) return null;
  return new Date(value).toISOString();
}

function comparisonWindow(start: Date, end: Date): number {
  return Math.min(MAX_WINDOW_MS, Math.max(MIN_WINDOW_MS, end.getTime() - start.getTime()));
}

async function countRows(input: { tenantId: string; table: string; timestampColumn: string; start: string; end: string; eventType?: string }): Promise<number> {
  let query = getDb()
    .from(input.table)
    .select('id')
    .eq('tenant_id', input.tenantId)
    .gte(input.timestampColumn, input.start)
    .lt(input.timestampColumn, input.end);
  if (input.eventType) query = query.eq('event_type', input.eventType);
  const { data, error } = await query;
  if (error) throw error;
  return (data || []).length;
}

function metric(key: ControlledExperimentMetricKey, label: string, before: number, after: number): ControlledExperimentMetricResult {
  const delta = after - before;
  return {
    key,
    label,
    before,
    after,
    delta,
    // Todas as três medidas representam sinais cujo menor valor é desejável.
    interpretation: delta < 0 ? 'improved' : delta > 0 ? 'worsened' : 'stable',
  };
}

/**
 * Compara dois períodos de mesma duração no mesmo tenant. É uma leitura de
 * evidência operacional, não uma atribuição causal e não aciona alterações no
 * agente. A contagem nunca retorna contatos, mensagens, valores ou prompts.
 */
export async function calculateControlledExperimentResult(input: {
  tenantId: string;
  experiment: ControlledExperiment;
  now?: Date;
}): Promise<ControlledExperimentResult> {
  const observationStart = dateIso(input.experiment.started_at);
  if (!observationStart) {
    return {
      experimentId: input.experiment.id,
      availability: 'not_started',
      baselineStart: null,
      baselineEnd: null,
      observationStart: null,
      observationEnd: null,
      windowHours: 0,
      metrics: [],
      limitations: ['O experimento ainda não possui início registrado; não há janela pós-experimento para comparar.'],
    };
  }

  const start = new Date(observationStart);
  const effectiveEnd = new Date(dateIso(input.experiment.ended_at) || (input.now || new Date()).toISOString());
  if (effectiveEnd.getTime() <= start.getTime()) {
    return {
      experimentId: input.experiment.id,
      availability: 'insufficient_data',
      baselineStart: null,
      baselineEnd: observationStart,
      observationStart,
      observationEnd: effectiveEnd.toISOString(),
      windowHours: 0,
      metrics: [],
      limitations: ['A janela de observação ainda não tem duração positiva.'],
    };
  }

  const windowMs = comparisonWindow(start, effectiveEnd);
  const baselineStart = new Date(start.getTime() - windowMs).toISOString();
  const baselineEnd = start.toISOString();
  const observationEnd = effectiveEnd.toISOString();

  const ranges = {
    before: { start: baselineStart, end: baselineEnd },
    after: { start: observationStart, end: observationEnd },
  };
  const [beforeCorrections, afterCorrections, beforeEscalations, afterEscalations, beforeBlocked, afterBlocked] = await Promise.all([
    countRows({ tenantId: input.tenantId, table: 'quality_audit_events', timestampColumn: 'created_at', eventType: 'contact_memory_corrected', ...ranges.before }),
    countRows({ tenantId: input.tenantId, table: 'quality_audit_events', timestampColumn: 'created_at', eventType: 'contact_memory_corrected', ...ranges.after }),
    countRows({ tenantId: input.tenantId, table: 'escalations', timestampColumn: 'created_at', ...ranges.before }),
    countRows({ tenantId: input.tenantId, table: 'escalations', timestampColumn: 'created_at', ...ranges.after }),
    countRows({ tenantId: input.tenantId, table: 'conversations', timestampColumn: 'ai_blocked_at', ...ranges.before }),
    countRows({ tenantId: input.tenantId, table: 'conversations', timestampColumn: 'ai_blocked_at', ...ranges.after }),
  ]);

  return {
    experimentId: input.experiment.id,
    availability: 'available',
    baselineStart,
    baselineEnd,
    observationStart,
    observationEnd,
    windowHours: Math.round((windowMs / (60 * 60 * 1000)) * 10) / 10,
    metrics: [
      metric('human_corrections', 'Correções humanas', beforeCorrections, afterCorrections),
      metric('escalations', 'Escalonamentos', beforeEscalations, afterEscalations),
      metric('blocked_responses', 'Respostas bloqueadas', beforeBlocked, afterBlocked),
    ],
    limitations: [
      'As métricas são sinais agregados do tenant em janelas equivalentes; elas não provam causalidade.',
      'Nenhum contato, mensagem, prompt, comprovante ou valor foi usado nesta leitura.',
      'A conclusão e qualquer publicação continuam dependendo de decisão humana separada.',
    ],
  };
}
