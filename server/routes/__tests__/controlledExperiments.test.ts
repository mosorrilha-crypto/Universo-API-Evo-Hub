import express from 'express';
import type { Server } from 'http';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createQualityAuditRouter } from '../qualityAudit';
import { initDb } from '../../services/db';
import { createFakeSupabase } from '../../services/__tests__/fakeSupabase';
import { getMandatoryStopConditions } from '../../services/controlledExperimentStore';

const TENANT_A = '11111111-1111-1111-1111-111111111111';
const TENANT_B = '22222222-2222-2222-2222-222222222222';
let server: Server;
let baseUrl: string;
let supabase: ReturnType<typeof createFakeSupabase>;

function fakeAuthenticateToken(req: any, _res: any, next: any) {
  req.user = { id: 'admin-a', tenantId: TENANT_A, role: 'admin' };
  next();
}

function testingReview(id: string, tenantId: string) {
  return {
    id,
    tenant_id: tenantId,
    kind: 'ai_suggestion',
    status: 'testing',
    title: 'Teste controlado para padrão: preferredName',
    description: 'Item de qualidade criado por decisão humana.',
    context: { source: 'memory_pattern_review', patternKey: 'preferredName' },
    created_at: '2026-08-22T12:00:00.000Z',
    updated_at: '2026-08-22T12:00:00.000Z',
  };
}

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use(createQualityAuditRouter({
    authenticateToken: fakeAuthenticateToken as any,
    isQualityModuleEnabled: async () => true,
  }));
  await new Promise<void>((resolve) => { server = app.listen(0, () => resolve()); });
  const address = server.address();
  baseUrl = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`;
});

afterAll(() => server.close());

beforeEach(() => {
  supabase = createFakeSupabase({
    quality_reviews: [testingReview('review-a', TENANT_A), testingReview('review-b', TENANT_B)],
    quality_audit_events: [],
    controlled_quality_experiments: [],
    escalations: [],
    conversations: [],
    memory_pattern_reviews: [],
  });
  initDb(supabase);
});

describe('experimentos controlados de Qualidade', () => {
  it('cria somente o desenho para um item em teste do tenant autenticado', async () => {
    const response = await fetch(`${baseUrl}/api/quality-audit/controlled-experiments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        qualityReviewId: 'review-a',
        hypothesis: 'Esclarecer a apresentação pode reduzir correções de nome.',
        variationSummary: 'Avaliação limitada e manual, sem publicar uma instrução de agente.',
        scopeRoutes: ['faq'],
        sampleLimit: 10,
        successCriteria: ['Reduzir correções humanas sem elevar escalonamentos.'],
        stopConditions: getMandatoryStopConditions(),
      }),
    });

    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.experiment).toMatchObject({ quality_review_id: 'review-a', status: 'draft', scope_routes: ['faq'], sample_limit: 10 });
    expect(JSON.stringify(body)).not.toContain('prompt completo');
    expect(supabase.__tables.quality_audit_events[0]).toMatchObject({ event_type: 'controlled_experiment_created' });
    expect(supabase.__tables.quality_audit_events[0].payload).not.toHaveProperty('hypothesis');
    expect(supabase.__tables.quality_audit_events[0].payload).not.toHaveProperty('variationSummary');
  });

  it('bloqueia item de outro tenant e registra somente a transição humana permitida', async () => {
    const foreign = await fetch(`${baseUrl}/api/quality-audit/controlled-experiments`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ qualityReviewId: 'review-b', hypothesis: 'x', variationSummary: 'x', scopeRoutes: ['faq'], sampleLimit: 5, successCriteria: ['x'], stopConditions: getMandatoryStopConditions() }),
    });
    expect(foreign.status).toBe(400);

    const create = await fetch(`${baseUrl}/api/quality-audit/controlled-experiments`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ qualityReviewId: 'review-a', hypothesis: 'Hipótese limitada.', variationSummary: 'Variação resumida.', scopeRoutes: ['triagem'], sampleLimit: 5, successCriteria: ['Menos correções.'], stopConditions: getMandatoryStopConditions() }),
    });
    const { experiment } = await create.json();

    const ready = await fetch(`${baseUrl}/api/quality-audit/controlled-experiments/${experiment.id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'ready', decisionNote: 'Desenho revisado.' }),
    });
    expect(ready.status).toBe(200);
    const readyBody = await ready.json();
    expect(readyBody.experiment.status).toBe('ready');

    const invalid = await fetch(`${baseUrl}/api/quality-audit/controlled-experiments/${experiment.id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'published' }),
    });
    expect(invalid.status).toBe(400);
  });
});


describe('resultado redigido do experimento', () => {
  it('retorna somente métricas agregadas do experimento pertencente ao tenant autenticado', async () => {
    supabase.__tables.controlled_quality_experiments.push({
      id: 'result-a', tenant_id: TENANT_A, quality_review_id: 'review-a', status: 'running', hypothesis: 'NÃO DEVOLVER', variation_summary: 'NÃO DEVOLVER', scope_routes: ['faq'], sample_limit: 5, success_criteria: ['NÃO DEVOLVER'], stop_conditions: ['NÃO DEVOLVER'], started_at: '2026-08-22T10:00:00.000Z', ended_at: '2026-08-22T12:00:00.000Z', created_at: '2026-08-22T09:00:00.000Z', updated_at: '2026-08-22T12:00:00.000Z',
    });
    supabase.__tables.escalations.push({ id: 'esc-a', tenant_id: TENANT_A, phone: '595981111111', created_at: '2026-08-22T11:00:00.000Z' });

    const response = await fetch(`${baseUrl}/api/quality-audit/controlled-experiments/result-a/results`);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.result).toMatchObject({ experimentId: 'result-a', availability: 'available' });
    expect(JSON.stringify(body)).not.toContain('595981111111');
    expect(JSON.stringify(body)).not.toContain('NÃO DEVOLVER');

    const foreign = await fetch(`${baseUrl}/api/quality-audit/controlled-experiments/result-b/results`);
    expect(foreign.status).toBe(404);
  });
});
