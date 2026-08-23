import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { MemoryPatternReviewQueue } from '../QualityAuditCenter';

describe('MemoryPatternReviewQueue', () => {
  it('mostra decisões supervisionadas e ignora padrões fora da allowlist visual', () => {
    const html = renderToStaticMarkup(
      <MemoryPatternReviewQueue
        isSpanish={false}
        isSyncing={false}
        decidingReviewId={null}
        candidates={[{ field: 'preferredName', count: 3 }]}
        reviews={[
          {
            id: 'review-safe',
            pattern_key: 'preferredName',
            evidence_count: 3,
            agent_routes: ['faq'],
            status: 'pending',
            review_note: null,
            linked_quality_review_id: null,
            created_at: '2026-08-22T10:00:00.000Z',
            updated_at: '2026-08-22T12:00:00.000Z',
          },
          {
            id: 'review-unsafe',
            pattern_key: 'paymentStatus',
            evidence_count: 8,
            agent_routes: ['faq'],
            status: 'pending',
            review_note: null,
            linked_quality_review_id: null,
            created_at: '2026-08-22T10:00:00.000Z',
            updated_at: '2026-08-22T12:00:00.000Z',
          },
        ] as any}
        onSyncQueue={() => undefined}
        onDecide={() => undefined}
      />,
    );

    expect(html).toContain('Fila supervisionada');
    expect(html).toContain('Nome');
    expect(html).toContain('Rascunho de conhecimento');
    expect(html).toContain('Teste controlado');
    expect(html).toContain('não publica nem altera o agente');
    expect(html).not.toContain('paymentStatus');
  });
});
