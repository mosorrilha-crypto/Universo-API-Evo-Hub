import { beforeEach, describe, expect, it } from 'vitest';
import { initDb } from '../db';
import { createFakeSupabase } from './fakeSupabase';
import { decideMemoryPatternReview, listMemoryPatternReviews, syncMemoryPatternReviewCandidates } from '../memoryPatternReviewStore';

const TENANT_A = '11111111-1111-1111-1111-111111111111';
const TENANT_B = '22222222-2222-2222-2222-222222222222';

beforeEach(() => initDb(createFakeSupabase()));

describe('memoryPatternReviewStore', () => {
  it('materializa candidatos recorrentes isolados por tenant e somente com metadados permitidos', async () => {
    await syncMemoryPatternReviewCandidates({
      tenantId: TENANT_A,
      candidates: [{ field: 'preferredName', count: 3 }, { field: 'paymentStatus', count: 9 }],
      agentRoutes: ['faq', 'unknown'],
      createdBy: 'operator-a',
    });
    await syncMemoryPatternReviewCandidates({
      tenantId: TENANT_B,
      candidates: [{ field: 'preferredName', count: 4 }],
      agentRoutes: ['agendamento'],
      createdBy: 'operator-b',
    });

    const rowsA = await listMemoryPatternReviews(TENANT_A);
    const rowsB = await listMemoryPatternReviews(TENANT_B);
    expect(rowsA).toHaveLength(1);
    expect(rowsA[0]).toMatchObject({ pattern_key: 'preferredName', evidence_count: 3, status: 'pending', agent_routes: ['faq', 'unknown'] });
    expect(rowsB).toHaveLength(1);
    expect(rowsB[0]).toMatchObject({ pattern_key: 'preferredName', evidence_count: 4, agent_routes: ['agendamento'] });
  });

  it('preserva a decisão humana ao sincronizar nova evidência e não cria vínculo automático', async () => {
    const [created] = await syncMemoryPatternReviewCandidates({
      tenantId: TENANT_A,
      candidates: [{ field: 'objections', count: 3 }],
      agentRoutes: ['faq'],
    });
    const decided = await decideMemoryPatternReview({
      tenantId: TENANT_A,
      reviewId: created.id,
      status: 'observed',
      reviewNote: 'Acompanhar antes de abrir qualquer teste.',
      decidedBy: 'admin-a',
    });
    expect(decided).toMatchObject({ status: 'observed', linked_quality_review_id: null, decided_by: 'admin-a' });

    await syncMemoryPatternReviewCandidates({
      tenantId: TENANT_A,
      candidates: [{ field: 'objections', count: 6 }],
      agentRoutes: ['faq', 'agendamento'],
    });
    const [updated] = await listMemoryPatternReviews(TENANT_A);
    expect(updated).toMatchObject({ evidence_count: 6, status: 'observed', review_note: 'Acompanhar antes de abrir qualquer teste.', linked_quality_review_id: null });
    expect(updated.agent_routes).toEqual(['faq', 'agendamento']);
  });

  it('não permite decidir um registro de outro tenant', async () => {
    const [created] = await syncMemoryPatternReviewCandidates({
      tenantId: TENANT_A,
      candidates: [{ field: 'serviceInterest', count: 3 }],
      agentRoutes: ['triagem'],
    });

    const result = await decideMemoryPatternReview({
      tenantId: TENANT_B,
      reviewId: created.id,
      status: 'dismissed',
      decidedBy: 'admin-b',
    });
    expect(result).toBeNull();
    expect((await listMemoryPatternReviews(TENANT_A))[0].status).toBe('pending');
  });
});
