/**
 * TASK-0208 — botão "Rodar avaliação automática" na Central de Qualidade.
 * Mocka `runAgentEvaluation` (já coberta por agentEvalService.test.ts nas
 * partes puras) pra testar só a responsabilidade da ROTA: criar o registro
 * de progresso, responder 202 IMEDIATAMENTE (sem esperar a avaliação
 * inteira terminar — ela roda em background), atualizar progresso via
 * onProgress, e marcar completed/failed no final — igual ao padrão já
 * usado em webhooksOperatorActivePause.test.ts (mocka a função grande,
 * roda o resto de verdade via HTTP).
 */
import express from 'express';
import type { Server } from 'http';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const runAgentEvaluation = vi.fn();
vi.mock('../../services/agentEvalService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../services/agentEvalService')>();
  return { ...actual, runAgentEvaluation };
});

const { createQualityAuditRouter } = await import('../qualityAudit');
const { initDb } = await import('../../services/db');
const { createFakeSupabase } = await import('../../services/__tests__/fakeSupabase');

const TENANT_A = '11111111-1111-1111-1111-111111111111';
const TENANT_B = '22222222-2222-2222-2222-222222222222';
let server: Server;
let baseUrl: string;
let supabase: ReturnType<typeof createFakeSupabase>;
let fakeAi: any = {};

function fakeAuthenticateToken(req: any, _res: any, next: any) {
  req.user = { id: 'admin-a', tenantId: TENANT_A, role: 'admin' };
  next();
}

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use(createQualityAuditRouter({
    authenticateToken: fakeAuthenticateToken as any,
    isQualityModuleEnabled: async () => true,
    getAi: () => fakeAi,
    groqApiKey: undefined,
  }));
  await new Promise<void>((resolve) => { server = app.listen(0, () => resolve()); });
  const address = server.address();
  baseUrl = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`;
});

afterAll(() => server.close());

beforeEach(() => {
  vi.clearAllMocks();
  fakeAi = {};
  supabase = createFakeSupabase({ agent_eval_runs: [] });
  initDb(supabase);
});

function waitForRunRow(id: string, tries = 20): Promise<any> {
  return new Promise((resolve, reject) => {
    let attempt = 0;
    const check = () => {
      const row = supabase.__tables.agent_eval_runs.find((r: any) => r.id === id);
      if (row && row.status !== 'running') return resolve(row);
      attempt++;
      if (attempt >= tries) return reject(new Error('run não terminou a tempo'));
      setTimeout(check, 10);
    };
    check();
  });
}

describe('POST /api/quality-audit/eval-runs', () => {
  it('503 quando o Gemini não está configurado', async () => {
    fakeAi = null;
    const response = await fetch(`${baseUrl}/api/quality-audit/eval-runs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ count: 10 }),
    });
    expect(response.status).toBe(503);
    expect(runAgentEvaluation).not.toHaveBeenCalled();
  });

  it('responde 202 IMEDIATAMENTE, antes da avaliação em background terminar', async () => {
    let resolveEval: (value: any) => void = () => {};
    runAgentEvaluation.mockReturnValueOnce(new Promise((resolve) => { resolveEval = resolve; }));

    const response = await fetch(`${baseUrl}/api/quality-audit/eval-runs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ count: 10 }),
    });
    expect(response.status).toBe(202);
    const { run } = await response.json();
    expect(run).toMatchObject({ tenantId: TENANT_A, status: 'running', requestedCount: 10 });

    // a promise da avaliação ainda não resolveu — a linha no banco continua "running"
    const stillRunning = supabase.__tables.agent_eval_runs.find((r: any) => r.id === run.id);
    expect(stillRunning?.status).toBe('running');

    resolveEval({ total: 10, passed: 10, failed: 0, createdReviewCount: 0, repeatedPhrases: [] });
  });

  it('grava progresso via onProgress e marca completed com repeatedPhraseCount ao terminar com sucesso', async () => {
    runAgentEvaluation.mockImplementationOnce(async (options: any) => {
      await options.onProgress({ completed: 3, total: 10, passed: 2, failed: 1 });
      return { total: 10, passed: 8, failed: 2, createdReviewCount: 2, repeatedPhrases: [{ phrase: 'x', count: 3 }] };
    });

    const response = await fetch(`${baseUrl}/api/quality-audit/eval-runs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ count: 10 }),
    });
    const { run } = await response.json();

    const finished = await waitForRunRow(run.id);
    expect(finished).toMatchObject({ status: 'completed', completed_count: 3, pass_count: 2, fail_count: 1, repeated_phrase_count: 1 });
  });

  it('marca failed com o erro quando runAgentEvaluation rejeita, sem derrubar o processo', async () => {
    runAgentEvaluation.mockRejectedValueOnce(new Error('Base de Conhecimento indisponível'));

    const response = await fetch(`${baseUrl}/api/quality-audit/eval-runs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ count: 10 }),
    });
    const { run } = await response.json();

    const finished = await waitForRunRow(run.id);
    expect(finished).toMatchObject({ status: 'failed', error: 'Base de Conhecimento indisponível' });
  });

  it('limita count ao intervalo [1, 100] e usa 10 como padrão quando ausente/inválido', async () => {
    runAgentEvaluation.mockResolvedValue({ total: 0, passed: 0, failed: 0, createdReviewCount: 0, repeatedPhrases: [] });

    const tooHigh = await fetch(`${baseUrl}/api/quality-audit/eval-runs`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ count: 500 }),
    });
    expect((await tooHigh.json()).run.requestedCount).toBe(100);

    const missing = await fetch(`${baseUrl}/api/quality-audit/eval-runs`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}),
    });
    expect((await missing.json()).run.requestedCount).toBe(10);

    const zero = await fetch(`${baseUrl}/api/quality-audit/eval-runs`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ count: 0 }),
    });
    expect((await zero.json()).run.requestedCount).toBe(1);
  });
});

describe('GET /api/quality-audit/eval-runs', () => {
  it('lista só as rodadas do tenant autenticado, nunca de outro tenant', async () => {
    // Nota: o fake de Supabase (createFakeSupabase) não implementa .order()
    // de verdade — devolve na ordem em que os dados foram inseridos no
    // fixture. Este teste valida o isolamento por tenant (a garantia real
    // de RLS/tenantOf), não a ordenação — isso é papel de um teste de
    // integração contra Postgres de verdade, não do fake em memória.
    supabase = createFakeSupabase({
      agent_eval_runs: [
        { id: 'r1', tenant_id: TENANT_A, status: 'completed', requested_count: 10, completed_count: 10, pass_count: 9, fail_count: 1, repeated_phrase_count: 0, started_at: '2026-09-01T10:00:00Z', finished_at: '2026-09-01T10:05:00Z' },
        { id: 'r2', tenant_id: TENANT_A, status: 'running', requested_count: 20, completed_count: 5, pass_count: 5, fail_count: 0, repeated_phrase_count: 0, started_at: '2026-09-01T11:00:00Z', finished_at: null },
        { id: 'r3', tenant_id: TENANT_B, status: 'completed', requested_count: 5, completed_count: 5, pass_count: 5, fail_count: 0, repeated_phrase_count: 0, started_at: '2026-09-01T12:00:00Z', finished_at: '2026-09-01T12:02:00Z' },
      ],
    });
    initDb(supabase);

    const response = await fetch(`${baseUrl}/api/quality-audit/eval-runs`);
    expect(response.status).toBe(200);
    const { runs } = await response.json();
    expect(runs.map((r: any) => r.id).sort()).toEqual(['r1', 'r2']);
    expect(runs.every((r: any) => r.tenantId === TENANT_A)).toBe(true);
  });
});
