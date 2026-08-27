/** PR3/#96 — a primeira renderização comunica que rascunhos não alteram o runtime do agente. */
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { KnowledgeBaseTypedDocumentsPanel } from '../KnowledgeBaseTypedDocumentsPanel';

describe('KnowledgeBaseTypedDocumentsPanel', () => {
  it('apresenta a área de versões e não sugere publicação automática ou corte de runtime', () => {
    const html = renderToStaticMarkup(<KnowledgeBaseTypedDocumentsPanel activeTenantId="tenant-a" />);

    expect(html).toContain('Documentos tipados e publicação');
    expect(html).toContain('Carregando versões publicadas e rascunhos');
    expect(html).toContain('agente ainda continua usando a Base de Conhecimento legada');
    expect(html).not.toContain('Publicar automaticamente');
  });

  it('informa que a publicação vale na próxima resposta quando o runtime tipado está ativo', () => {
    const html = renderToStaticMarkup(<KnowledgeBaseTypedDocumentsPanel activeTenantId="tenant-a" isRuntimePublished />);

    expect(html).toContain('A cada nova resposta, o agente consulta somente os documentos publicados.');
    expect(html).not.toContain('Publicar automaticamente');
  });
});
