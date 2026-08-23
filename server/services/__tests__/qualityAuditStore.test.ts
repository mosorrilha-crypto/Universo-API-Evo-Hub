import { beforeEach, describe, expect, it } from 'vitest';
import { initDb } from '../db';
import { createFakeSupabase } from './fakeSupabase';
import { createQualityReview, deriveMemoryCorrectionInsights, deriveQualityRecommendations, listQualityReviews, recordQualityAuditEvent, updateQualityReview } from '../qualityAuditStore';

const TENANT_A = '11111111-1111-1111-1111-111111111111';
const TENANT_B = '22222222-2222-2222-2222-222222222222';

beforeEach(() => {
  initDb(createFakeSupabase());
});

describe('qualityAuditStore — auditoria e aprendizado supervisionado', () => {
  it('cria uma revisão pendente com contexto estruturado', async () => {
    const review = await createQualityReview({
      tenantId: TENANT_A,
      kind: 'operator_idea',
      title: 'Mostrar cobrança na conversa',
      description: 'O operador precisa abrir outra tela para consultar o valor.',
      context: { source: 'whatsapp_conversation', conversationPhone: '595981111111' },
      createdBy: 'operator-a',
    });

    expect(review.status).toBe('pending');
    expect(review.context.conversationPhone).toBe('595981111111');
    expect((await listQualityReviews(TENANT_A))).toHaveLength(1);
  });

  it('mantém as revisões isoladas entre tenants', async () => {
    await createQualityReview({ tenantId: TENANT_A, kind: 'bug', title: 'Bug A', description: 'Somente tenant A.' });
    await createQualityReview({ tenantId: TENANT_B, kind: 'bug', title: 'Bug B', description: 'Somente tenant B.' });

    expect((await listQualityReviews(TENANT_A)).map((item) => item.title)).toEqual(['Bug A']);
    expect((await listQualityReviews(TENANT_B)).map((item) => item.title)).toEqual(['Bug B']);
  });

  it('atualiza o status e registra feedback sem apagar o conteúdo original', async () => {
    const review = await createQualityReview({
      tenantId: TENANT_A,
      kind: 'ai_suggestion',
      title: 'Possível comprovante',
      description: 'Imagem precisa de conferência humana.',
      originalValue: 'R$ 100',
      context: { decision: 'pending' },
    });
    const updated = await updateQualityReview({
      tenantId: TENANT_A,
      reviewId: review.id,
      status: 'testing',
      correctedValue: 'Cobrança #42',
      reviewNote: 'Vínculo correto para testar.',
      reviewedBy: 'admin-a',
    });

    expect(updated?.status).toBe('testing');
    expect(updated?.original_value).toBe('R$ 100');
    expect(updated?.corrected_value).toBe('Cobrança #42');
    expect(updated?.review_note).toBe('Vínculo correto para testar.');
  });

  it('deriva recomendações somente quando existe evidência repetida', () => {
    const base = (id: string, kind: 'ai_suggestion' | 'bug' | 'operator_idea', context: Record<string, unknown>, status: any = 'pending') => ({
      id,
      tenant_id: TENANT_A,
      kind,
      status,
      title: id,
      description: id,
      context,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    } as any);

    expect(deriveQualityRecommendations([base('one', 'ai_suggestion', { decision: 'corrected' })])).toEqual([]);
    const recommendations = deriveQualityRecommendations([
      base('one', 'ai_suggestion', { decision: 'corrected' }),
      base('two', 'ai_suggestion', { decision: 'corrected' }),
      base('three', 'ai_suggestion', { decision: 'corrected' }),
      base('bug', 'bug', {}, 'pending'),
      base('idea', 'operator_idea', {}, 'pending'),
    ]);
    expect(recommendations.map((item) => item.id)).toEqual(['repeated-corrections', 'pending-ideas']);
  });

  it('agrega correções de memória por campo e rota sem carregar telefone, ator ou valores editados', () => {
    const event = (id: string, fields: unknown[], agentRoute: string, createdAt: string) => ({
      id,
      tenant_id: TENANT_A,
      event_type: 'contact_memory_corrected',
      source: 'atendimento_context_panel',
      entity_type: 'contact_agent_memory',
      entity_id: `${TENANT_A}:telefone-privado`,
      conversation_phone: '595981111111',
      actor_id: 'operator-a',
      payload: { changedFields: fields, agentRoute, preferredName: 'NÃO DEVE APARECER' },
      created_at: createdAt,
    } as any);
    const insights = deriveMemoryCorrectionInsights([
      event('one', ['preferredName', 'serviceInterest', 'paymentStatus'], 'faq', '2026-08-22T10:00:00.000Z'),
      event('two', ['preferredName'], 'faq', '2026-08-22T11:00:00.000Z'),
      event('three', ['preferredName', 'objections'], 'agendamento', '2026-08-22T12:00:00.000Z'),
      { ...event('other', ['serviceInterest'], 'faq', '2026-08-22T13:00:00.000Z'), event_type: 'crm_lead_updated' },
    ]);

    expect(insights.totalCorrections).toBe(3);
    expect(insights.topFields).toEqual([
      { field: 'preferredName', count: 3 },
      { field: 'objections', count: 1 },
      { field: 'serviceInterest', count: 1 },
    ]);
    expect(insights.byAgentRoute).toEqual([{ route: 'faq', count: 2 }, { route: 'agendamento', count: 1 }]);
    expect(insights.reviewCandidates).toEqual([{ field: 'preferredName', count: 3 }]);
    expect(JSON.stringify(insights)).not.toContain('595981111111');
    expect(JSON.stringify(insights)).not.toContain('NÃO DEVE APARECER');
  });

  it('registra eventos de auditoria no tenant correto', async () => {
    const event = await recordQualityAuditEvent({
      tenantId: TENANT_A,
      eventType: 'payment_receipt_detected',
      source: 'whatsapp_webhook',
      entityType: 'quality_review',
      entityId: 'review-1',
      conversationPhone: '595981111111',
      payload: { requiresHumanReview: true },
    });

    expect(event.tenant_id).toBe(TENANT_A);
    expect(event.payload.requiresHumanReview).toBe(true);
  });
});
