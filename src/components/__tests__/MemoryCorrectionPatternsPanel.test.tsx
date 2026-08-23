import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { MemoryCorrectionPatternsPanel } from '../QualityAuditCenter';

describe('MemoryCorrectionPatternsPanel', () => {
  it('exibe somente os metadados permitidos de correções e ignora campos inesperados', () => {
    const html = renderToStaticMarkup(
      <MemoryCorrectionPatternsPanel
        loading={false}
        isSpanish={false}
        insights={{
          totalCorrections: 3,
          topFields: [
            { field: 'preferredName', count: 3 },
            { field: 'internalSecret', count: 9 },
          ],
          byAgentRoute: [
            { route: 'faq', count: 2 },
            { route: 'unexpected-route', count: 1 },
          ],
          recentCorrections: [
            { createdAt: '2026-08-22T12:00:00.000Z', fields: ['preferredName', 'internalSecret'], agentRoute: 'faq' },
          ],
          reviewCandidates: [
            { field: 'preferredName', count: 3 },
            { field: 'internalSecret', count: 9 },
          ],
        } as any}
      />,
    );

    expect(html).toContain('Nome');
    expect(html).toContain('Dúvidas e informações');
    expect(html).toContain('Revisão humana recomendada');
    expect(html).not.toContain('internalSecret');
    expect(html).not.toContain('unexpected-route');
  });
});
