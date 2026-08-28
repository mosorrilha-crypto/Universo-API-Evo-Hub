import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { SystemLogsPanel } from '../SystemLogsPanel';

const incident = {
  id: 'incident-1', tenantId: 'tenant-a', sourceKey: 'system:knowledgeBase:loadRuntimeSource:legacy-fallback', category: 'knowledge_base' as const,
  severity: 'high' as const, status: 'open' as const, title: 'Fonte legada usada como contingência', detail: 'source=legacy_blob',
  suggestedAction: 'Revise os documentos publicados.', metadata: {}, occurrenceCount: 2, firstSeenAt: new Date().toISOString(), lastSeenAt: new Date().toISOString(),
};

describe('SystemLogsPanel', () => {
  it('exibe incidente, recorrência e sugestão sem ação automática', () => {
    const html = renderToStaticMarkup(<SystemLogsPanel incidents={[incident]} onRefresh={() => undefined} onReview={() => undefined} onResolve={() => undefined} onArchive={() => undefined} onRestore={() => undefined} />);
    expect(html).toContain('Logs do Sistema');
    expect(html).toContain('Sugestão de correção');
    expect(html).toContain('2 ocorrências');
    expect(html).toContain('Nenhuma alteração é automática');
  });
});
