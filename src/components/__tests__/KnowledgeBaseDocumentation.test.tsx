import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { KnowledgeBaseDocumentation } from '../KnowledgeBaseDocumentation';

describe('KnowledgeBaseDocumentation', () => {
  it('explica os oito documentos, o fluxo de publicação e os limites do runtime', () => {
    const html = renderToStaticMarkup(<KnowledgeBaseDocumentation isRuntimePublished onBack={() => undefined} />);

    expect(html).toContain('Documentação da Base de Conhecimento');
    expect(html).toContain('Os oito documentos que formam a publicação');
    expect(html).toContain('service_catalog');
    expect(html).toContain('human_handoff_rules');
    expect(html).toContain('Uma mudança só chega ao agente depois de ser publicada');
    expect(html).toContain('Rascunho não é produção');
    expect(html).toContain('Proteção de continuidade');
    expect(html).toContain('O editor legado permanece disponível para auditoria e rollback');
  });

  it('explica quando a publicação tipada ainda não é a fonte do runtime', () => {
    const html = renderToStaticMarkup(<KnowledgeBaseDocumentation isRuntimePublished={false} onBack={() => undefined} />);

    expect(html).toContain('Publicação tipada em preparação');
    expect(html).toContain('a fonte de runtime ainda é a Base de Conhecimento legada');
  });
});
