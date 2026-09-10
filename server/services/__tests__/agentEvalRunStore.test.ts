/**
 * Achado real (03/09/2026): uma rodada de avaliação automática do agente
 * fica presa em status "running" pra sempre se o processo Node reiniciar
 * no meio dela (ex.: um deploy) — nenhum outro processo sabe que ela
 * existe pra terminar, e o painel mostra a barra de progresso girando
 * indefinidamente. Duas rodadas reais ficaram órfãs assim durante esta
 * mesma sessão de trabalho, cada uma coincidindo com um deploy em
 * andamento. Cobre a reconciliação que marca essas linhas como "failed"
 * na subida do servidor.
 */
import { describe, expect, it, beforeEach } from 'vitest';
import { initDb, getDb } from '../db';
import { createFakeSupabase } from './fakeSupabase';
import { createAgentEvalRun, finishAgentEvalRun, reconcileOrphanedAgentEvalRuns } from '../agentEvalRunStore';

const TENANT_A = '11111111-1111-1111-1111-111111111111';

beforeEach(() => {
  initDb(createFakeSupabase() as any, { supabaseUrl: 'x', supabaseKey: 'x' } as any);
});

describe('reconcileOrphanedAgentEvalRuns', () => {
  it('marca como failed qualquer rodada presa em running, sem tocar rodadas já terminadas', async () => {
    const orphaned = await createAgentEvalRun({ tenantId: TENANT_A, requestedCount: 10 });
    const alreadyCompleted = await createAgentEvalRun({ tenantId: TENANT_A, requestedCount: 5 });
    await finishAgentEvalRun(alreadyCompleted.id, { status: 'completed' });

    const reconciledCount = await reconcileOrphanedAgentEvalRuns();
    expect(reconciledCount).toBe(1);

    const db = getDb();
    const { data: orphanedRow } = await db.from('agent_eval_runs').select('*').eq('id', orphaned.id).single();
    expect(orphanedRow.status).toBe('failed');
    expect(orphanedRow.error).toContain('reiniciado');
    expect(orphanedRow.finished_at).toBeTruthy();

    const { data: completedRow } = await db.from('agent_eval_runs').select('*').eq('id', alreadyCompleted.id).single();
    expect(completedRow.status).toBe('completed');
    expect(completedRow.error).toBeNull();
  });

  it('não quebra e devolve 0 quando não há nenhuma rodada presa', async () => {
    await expect(reconcileOrphanedAgentEvalRuns()).resolves.toBe(0);
  });
});
