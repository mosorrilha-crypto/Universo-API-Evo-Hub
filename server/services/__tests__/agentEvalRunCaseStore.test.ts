/**
 * TASK-0249 — pedido direto do dono do produto: poder ver a lista completa
 * de perguntas sintéticas geradas numa rodada de avaliação automática, COM
 * as respostas — inclusive os casos que PASSARAM. Antes desta tabela,
 * `onCaseResult` (agentEvalService.runAgentEvaluation) já calculava tudo
 * isso, mas a rota do painel nunca conectava o callback a nenhuma
 * persistência — só os casos que falham viravam achado em quality_reviews.
 */
import { describe, expect, it, beforeEach } from 'vitest';
import { initDb } from '../db';
import { createFakeSupabase } from './fakeSupabase';
import { createAgentEvalRun } from '../agentEvalRunStore';
import { recordAgentEvalRunCase, listAgentEvalRunCases } from '../agentEvalRunCaseStore';

const TENANT_A = '11111111-1111-1111-1111-111111111111';
const TENANT_B = '22222222-2222-2222-2222-222222222222';

beforeEach(() => {
  initDb(createFakeSupabase() as any, { supabaseUrl: 'x', supabaseKey: 'x' } as any);
});

describe('agentEvalRunCaseStore', () => {
  it('registra e lista casos aprovados e reprovados de uma rodada, na ordem em que ocorreram', async () => {
    const run = await createAgentEvalRun({ tenantId: TENANT_A, requestedCount: 2 });

    await recordAgentEvalRunCase({
      runId: run.id,
      tenantId: TENANT_A,
      category: 'faq',
      question: 'Quanto custa o Lash Lift?',
      agent: 'faq',
      bubbles: ['O Lash Lift sai por Gs 140.000.'],
      passed: true,
      safetyApproved: true,
    });
    await recordAgentEvalRunCase({
      runId: run.id,
      tenantId: TENANT_A,
      category: 'idioma',
      question: 'Hola, cuanto cuesta?',
      agent: 'faq',
      bubbles: ['O valor é Gs 100.000.'],
      passed: false,
      safetyApproved: false,
      safetyReason: 'Idioma inadequado (português em vez de espanhol).',
      qualityIssues: ['Mistura de idiomas'],
    });

    const cases = await listAgentEvalRunCases(TENANT_A, run.id);
    expect(cases).toHaveLength(2);
    expect(cases[0]).toMatchObject({ category: 'faq', passed: true, question: 'Quanto custa o Lash Lift?' });
    expect(cases[1]).toMatchObject({ category: 'idioma', passed: false, safetyReason: 'Idioma inadequado (português em vez de espanhol).', qualityIssues: ['Mistura de idiomas'] });
  });

  it('nunca devolve casos de outro tenant nem de outra rodada (isolamento)', async () => {
    const runA = await createAgentEvalRun({ tenantId: TENANT_A, requestedCount: 1 });
    const runB = await createAgentEvalRun({ tenantId: TENANT_B, requestedCount: 1 });

    await recordAgentEvalRunCase({ runId: runA.id, tenantId: TENANT_A, category: 'faq', question: 'Pergunta A', passed: true });
    await recordAgentEvalRunCase({ runId: runB.id, tenantId: TENANT_B, category: 'faq', question: 'Pergunta B', passed: true });

    const casesForRunA = await listAgentEvalRunCases(TENANT_A, runA.id);
    expect(casesForRunA).toHaveLength(1);
    expect(casesForRunA[0].question).toBe('Pergunta A');

    const crossTenantAttempt = await listAgentEvalRunCases(TENANT_A, runB.id);
    expect(crossTenantAttempt).toHaveLength(0);
  });
});
