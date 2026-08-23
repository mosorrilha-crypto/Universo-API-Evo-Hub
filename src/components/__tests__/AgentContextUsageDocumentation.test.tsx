import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { AgentContextUsageDocumentation } from '../AgentContextUsageDocumentation';
import { QualityAuditCenter } from '../QualityAuditCenter';
import { AppPreferencesProvider } from '../../contexts/AppPreferencesContext';

describe('AgentContextUsageDocumentation', () => {
  it('documenta o fluxo supervisionado e os gates humanos obrigatórios', () => {
    const html = renderToStaticMarkup(<AgentContextUsageDocumentation onBack={() => undefined} />);

    expect(html).toContain('quality-workspace--clear');
    expect(html).toContain('Como utilizar o contexto supervisionado');
    expect(html).toContain('Fluxograma de utilização');
    expect(html).toContain('Correção auditável');
    expect(html).toContain('Padrão em revisão');
    expect(html).toContain('Teste limitado');
    expect(html).toContain('Decisão humana');
    expect(html).toContain('Confirmação de pagamento');
    expect(html).toContain('Confirmação final de agenda');
    expect(html).toContain('Agendamento permanece fora do escopo');
  });

  it('explica a leitura agregada sem expor conteúdo ou ativar promoção automática', () => {
    const html = renderToStaticMarkup(<AgentContextUsageDocumentation onBack={() => undefined} />);

    expect(html).toContain('Correções humanas');
    expect(html).toContain('Escalonamentos');
    expect(html).toContain('Respostas bloqueadas');
    expect(html).toContain('Menor é melhor.');
    expect(html).toContain('não retorna conteúdo da conversa, telefone, prompt, comprovante, hipótese, variação, notas ou valores corrigidos');
    expect(html).toContain('nunca promove uma variação automaticamente');
  });

  it('oferece um botão visível de acesso na Central de Qualidade', () => {
    const html = renderToStaticMarkup(
      <AppPreferencesProvider>
        <QualityAuditCenter onToast={() => undefined} />
      </AppPreferencesProvider>,
    );

    expect(html).toContain('quality-workspace--clear');
    expect(html).toContain('Como usar');
    expect(html).toContain('Melhorias do atendimento');
  });
});
