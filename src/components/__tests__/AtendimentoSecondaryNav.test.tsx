// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AtendimentoSecondaryNav } from '../AtendimentoSecondaryNav';

/**
 * TASK-0319: `.atendimento-bottom-nav` (Conversas/Pendências/Agenda/Ferramentas)
 * só existe dentro de WhatsAppLeadsSim.tsx, montado sempre mas escondido via
 * `hidden` no wrapper de App.tsx sempre que a aba ativa não é 'whatsapp' —
 * ao abrir Escalonamentos/Agenda no celular, o menu inferior some por
 * completo e "Conversas" deixa de ser selecionável. Este nav standalone
 * (renderizado por App.tsx fora daquele wrapper escondido) restaura essa
 * possibilidade sem depender de nenhum estado interno de WhatsAppLeadsSim.
 */
describe('AtendimentoSecondaryNav', () => {
  afterEach(() => cleanup());

  it('permite voltar para Conversas e navegar entre Pendências/Agenda/Ferramentas', () => {
    const onGoToConversas = vi.fn();
    const onGoToEscalations = vi.fn();
    const onGoToAgenda = vi.fn();
    const onGoToTools = vi.fn();

    render(
      <AtendimentoSecondaryNav
        activeTab="escalations"
        onGoToConversas={onGoToConversas}
        onGoToEscalations={onGoToEscalations}
        onGoToAgenda={onGoToAgenda}
        onGoToTools={onGoToTools}
        escalationsPendingCount={3}
      />
    );

    fireEvent.click(screen.getByText('Conversas'));
    expect(onGoToConversas).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByText('Agenda'));
    expect(onGoToAgenda).toHaveBeenCalledTimes(1);

    // TASK-0326: "Ferramentas" precisa estar sempre presente aqui, mesmo
    // padrão dos 4 ícones da barra inferior de Conversas.
    fireEvent.click(screen.getByText('Ferramentas'));
    expect(onGoToTools).toHaveBeenCalledTimes(1);

    expect(screen.getByText('3')).toBeTruthy();
  });

  it('marca a aba ativa, omite Agenda quando o operador não tem acesso ao módulo, mas mantém Ferramentas', () => {
    render(
      <AtendimentoSecondaryNav
        activeTab="agenda"
        onGoToConversas={() => undefined}
        onGoToEscalations={() => undefined}
        onGoToTools={() => undefined}
        escalationsPendingCount={0}
      />
    );

    expect(screen.queryByText('Agenda')).toBeNull();
    expect(screen.queryByText('0')).toBeNull();
    expect(screen.getByText('Ferramentas')).toBeTruthy();
  });
});
