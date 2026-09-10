// @vitest-environment jsdom
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import AtendimentoWorkspaceFrame from '../AtendimentoWorkspaceFrame';

// TASK-0212 (pedido direto, 01/09/2026, comparação com o WhatsApp Web): o
// cabeçalho "Atendimento" + seletor de empresa (testado aqui antes) foi
// removido — era redundante com a aba "Conversas" já ativa em Header.tsx e
// duplicava o seletor de empresa que já existe no menu de perfil do SaaS
// Admin (coberto por Header.empresasMenu.test.tsx). O componente agora é só
// um wrapper de layout (`.atendimento-workspace`/`__content`), que a cadeia
// de flexbox da TASK-0159/0162/0196 depende pra resolver a altura do
// Atendimento.
describe('AtendimentoWorkspaceFrame', () => {
  it('renderiza os filhos dentro do wrapper de layout, sem nenhum cabeçalho próprio', () => {
    const html = renderToStaticMarkup(
      <AtendimentoWorkspaceFrame>
        <div>Conteúdo</div>
      </AtendimentoWorkspaceFrame>,
    );

    expect(html).toContain('atendimento-workspace');
    expect(html).toContain('atendimento-workspace__content');
    expect(html).toContain('Conteúdo');
    expect(html).not.toContain('atendimento-workspace__header');
    expect(html).not.toContain('aria-haspopup="menu"');
  });
});
