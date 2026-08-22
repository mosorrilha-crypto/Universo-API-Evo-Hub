import { beforeEach, describe, expect, it } from 'vitest';
import { initDb } from '../db';
import { createFakeSupabase } from './fakeSupabase';
import { calculateControlledExperimentResult } from '../controlledExperimentResults';

const TENANT_A = '11111111-1111-1111-1111-111111111111';
const TENANT_B = '22222222-2222-2222-2222-222222222222';

function experiment(overrides: Record<string, unknown> = {}) {
  return {
    id: 'experiment-a', tenant_id: TENANT_A, quality_review_id: 'review-a', status: 'running', hypothesis: 'Hipótese redigida', variation_summary: 'Resumo redigido', scope_routes: ['faq'], sample_limit: 10, success_criteria: ['Menos correções'], stop_conditions: ['Parada obrigatória'], outcome_summary: null, decision_note: null, created_by: null, activated_by: null, decided_by: null, started_at: '2026-08-22T12:00:00.000Z', ended_at: null, created_at: '2026-08-22T11:00:00.000Z', updated_at: '2026-08-22T12:00:00.000Z', ...overrides,
  } as any;
}

beforeEach(() => {
  initDb(createFakeSupabase({
    quality_audit_events: [
      { id: 'before-correction', tenant_id: TENANT_A, event_type: 'contact_memory_corrected', created_at: '2026-08-22T10:30:00.000Z', payload: { changedFields: ['preferredName'], secret: 'NUNCA_EXIBIR' } },
      { id: 'after-correction', tenant_id: TENANT_A, event_type: 'contact_memory_corrected', created_at: '2026-08-22T12:30:00.000Z', payload: { changedFields: ['preferredName'], secret: 'NUNCA_EXIBIR' } },
      { id: 'foreign-correction', tenant_id: TENANT_B, event_type: 'contact_memory_corrected', created_at: '2026-08-22T12:30:00.000Z', payload: { changedFields: ['preferredName'] } },
    ],
    escalations: [
      { id: 'before-escalation', tenant_id: TENANT_A, phone: '595981111111', created_at: '2026-08-22T10:15:00.000Z' },
      { id: 'after-escalation-one', tenant_id: TENANT_A, phone: '595981222222', created_at: '2026-08-22T12:15:00.000Z' },
      { id: 'after-escalation-two', tenant_id: TENANT_A, phone: '595981333333', created_at: '2026-08-22T13:15:00.000Z' },
      { id: 'foreign-escalation', tenant_id: TENANT_B, phone: '595981444444', created_at: '2026-08-22T12:15:00.000Z' },
    ],
    conversations: [
      { id: 'before-blocked', tenant_id: TENANT_A, ai_blocked_at: '2026-08-22T10:45:00.000Z', phone: '595981111111' },
      { id: 'after-blocked', tenant_id: TENANT_A, ai_blocked_at: '2026-08-22T12:45:00.000Z', phone: '595981222222' },
      { id: 'foreign-blocked', tenant_id: TENANT_B, ai_blocked_at: '2026-08-22T12:45:00.000Z', phone: '595981333333' },
    ],
  }));
});

describe('calculateControlledExperimentResult', () => {
  it('compara janelas equivalentes do mesmo tenant e retorna apenas contagens redigidas', async () => {
    const result = await calculateControlledExperimentResult({ tenantId: TENANT_A, experiment: experiment(), now: new Date('2026-08-22T14:00:00.000Z') });

    expect(result).toMatchObject({ availability: 'available', windowHours: 2, baselineStart: '2026-08-22T10:00:00.000Z', observationStart: '2026-08-22T12:00:00.000Z' });
    expect(result.metrics).toEqual([
      expect.objectContaining({ key: 'human_corrections', before: 1, after: 1, delta: 0, interpretation: 'stable' }),
      expect.objectContaining({ key: 'escalations', before: 1, after: 2, delta: 1, interpretation: 'worsened' }),
      expect.objectContaining({ key: 'blocked_responses', before: 1, after: 1, delta: 0, interpretation: 'stable' }),
    ]);
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain('595981');
    expect(serialized).not.toContain('NUNCA_EXIBIR');
    expect(serialized).not.toContain('Hipótese redigida');
  });

  it('não calcula resultado antes do início e não faz inferência de efeito', async () => {
    const result = await calculateControlledExperimentResult({ tenantId: TENANT_A, experiment: experiment({ started_at: null }), now: new Date('2026-08-22T14:00:00.000Z') });
    expect(result.availability).toBe('not_started');
    expect(result.metrics).toEqual([]);
    expect(result.limitations[0]).toContain('ainda não possui início');
  });
});
