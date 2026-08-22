import express from 'express';
import type { Server } from 'http';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createQualityAuditRouter } from '../qualityAudit';
import { initDb } from '../../services/db';
import { createFakeSupabase } from '../../services/__tests__/fakeSupabase';

const TENANT_A = '11111111-1111-1111-1111-111111111111';
const TENANT_B = '22222222-2222-2222-2222-222222222222';
let server: Server;
let baseUrl: string;
let supabase: ReturnType<typeof createFakeSupabase>;

function fakeAuthenticateToken(req: any, _res: any, next: any) {
  req.user = { id: 'admin-a', tenantId: TENANT_A, role: 'admin' };
  next();
}

function correctionEvent(id: string, tenantId: string, createdAt: string) {
  return {
    id,
    tenant_id: tenantId,
    event_type: 'contact_memory_corrected',
    source: 'atendimento_context_panel',
    entity_type: 'contact_agent_memory',
    entity_id: `${tenantId}:redacted`,
    conversation_phone: '595981111111',
    actor_id: 'operator-id',
    payload: { changedFields: ['preferredName'], agentRoute: 'faq', editedValue: 'NUNCA_EXIBIR' },
    created_at: createdAt,
  };
}

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use(createQualityAuditRouter({ authenticateToken: fakeAuthenticateToken as any }));
  await new Promise<void>((resolve) => { server = app.listen(0, resolve); });
  const address = server.address();
  baseUrl = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`;
});

afterAll(() => server.close());

beforeEach(() => {
  supabase = createFakeSupabase({
    quality_audit_events: [
      correctionEvent('a', TENANT_A, '2026-08-22T10:00:00.000Z'),
      correctionEvent('b', TENANT_A, '2026-08-22T11:00:00.000Z'),
      correctionEvent('c', TENANT_A, '2026-08-22T12:00:00.000Z'),
      correctionEvent('other', TENANT_B, '2026-08-22T13:00:00.000Z'),
    ],
    quality_reviews: [],
    memory_pattern_reviews: [],
  });
  initDb(supabase);
});

describe('fila de revisão de padrões de memória', () => {
  it('materializa somente candidatos do tenant autenticado e devolve agregados redigidos', async () => {
    const response = await fetch(`${baseUrl}/api/quality-audit/memory-pattern-reviews/sync`, { method: 'POST' });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.reviews).toHaveLength(1);
    expect(body.reviews[0]).toMatchObject({ pattern_key: 'preferredName', evidence_count: 3, status: 'pending' });
    expect(JSON.stringify(body)).not.toContain('595981111111');
    expect(JSON.stringify(body)).not.toContain('NUNCA_EXIBIR');

    const rows = supabase.__tables.memory_pattern_reviews;
    expect(rows).toHaveLength(1);
    expect(rows[0].tenant_id).toBe(TENANT_A);
  });

  it('só cria um item de Qualidade quando o admin escolhe teste controlado, sem publicar ou tocar no agente', async () => {
    const sync = await fetch(`${baseUrl}/api/quality-audit/memory-pattern-reviews/sync`, { method: 'POST' });
    const { reviews } = await sync.json();

    const response = await fetch(`${baseUrl}/api/quality-audit/memory-pattern-reviews/${reviews[0].id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'prompt_test', reviewNote: 'Validar em ambiente controlado antes de qualquer publicação.' }),
    });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.review).toMatchObject({ status: 'prompt_test' });
    expect(body.review.linked_quality_review_id).toBeTruthy();

    expect(supabase.__tables.quality_reviews).toHaveLength(1);
    expect(supabase.__tables.quality_reviews[0]).toMatchObject({ kind: 'ai_suggestion', status: 'testing' });
    expect(supabase.__tables.quality_reviews[0].context).toEqual({
      source: 'memory_pattern_review',
      patternKey: 'preferredName',
      evidenceCount: 3,
      agentRoutes: ['faq'],
    });
    expect(supabase.__tables.quality_audit_events.some((event: any) => event.event_type === 'memory_pattern_review_decided')).toBe(true);
  });
});
