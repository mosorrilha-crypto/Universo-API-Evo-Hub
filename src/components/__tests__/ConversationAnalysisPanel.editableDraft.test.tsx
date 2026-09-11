// @vitest-environment jsdom
/**
 * TASK-0383 (pedido direto, prints do celular):
 * 1. A tradução usava um <details>/<summary> nativo do HTML — suporte
 *    inconsistente entre navegadores/WebViews mobile fazia a tradução não
 *    aparecer em pelo menos um aparelho. Trocado por um toggle controlado
 *    em React (mesmo padrão de `showContext` já usado neste arquivo).
 * 2. O rascunho sugerido (tanto o da análise quanto o do hint) virou
 *    editável direto na Ficha IA, sem precisar primeiro "levar pra revisão
 *    no compositor" pra poder ajustar uma palavra.
 */
import React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConversationAnalysisPanel } from '../ConversationAnalysisPanel';
import type { FullConversationAnalysis } from '../../types';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const baseAnalysis: FullConversationAnalysis = {
  leadStage: 'Negociação',
  dealProbability: 60,
  overallSentiment: 'Neutro',
  urgencyLevel: 2,
  conversationSummary: 'Cliente perguntando sobre horários disponíveis.',
  extractedCRMData: {},
  keyTopicsDiscussed: [],
  multiModalInsights: [],
  recommendedNextAction: 'Confirmar horário',
  suggestedSmartReply: '¿Te queda mejor el de 08:30 o el de 13:30?',
  suggestedSmartReplyTranslation: 'Qual horário fica melhor para você, 08:30 ou 13:30?',
  source: 'gemini',
};

describe('ConversationAnalysisPanel — rascunho editável e tradução', () => {
  it('a tradução fica escondida por padrão e aparece ao tocar no botão (sem depender de <details> nativo)', async () => {
    render(
      <ConversationAnalysisPanel
        analysis={baseAnalysis}
        isLoading={false}
        onReanalyze={vi.fn()}
        leadName="Gloria"
      />
    );

    expect(screen.queryByText('Qual horário fica melhor para você, 08:30 ou 13:30?')).toBeNull();

    await act(async () => {
      fireEvent.click(screen.getByText('Ver tradução para revisão interna'));
    });

    expect(screen.getByText('Qual horário fica melhor para você, 08:30 ou 13:30?')).not.toBeNull();
  });

  it('o rascunho recomendado é editável e a edição é o que vai pro compositor', async () => {
    const onDraftSuggestedReply = vi.fn();
    render(
      <ConversationAnalysisPanel
        analysis={baseAnalysis}
        isLoading={false}
        onReanalyze={vi.fn()}
        leadName="Gloria"
        onDraftSuggestedReply={onDraftSuggestedReply}
      />
    );

    const textarea = screen.getByDisplayValue('¿Te queda mejor el de 08:30 o el de 13:30?') as HTMLTextAreaElement;
    await act(async () => {
      fireEvent.change(textarea, { target: { value: '¿Te queda mejor a las 08:30?' } });
    });

    await act(async () => {
      fireEvent.click(screen.getByText('Levar para revisão no compositor'));
    });

    expect(onDraftSuggestedReply).toHaveBeenCalledWith('¿Te queda mejor a las 08:30?');
  });

  it('editar o rascunho de uma análise e depois receber uma análise nova reseta pro novo texto', async () => {
    const { rerender } = render(
      <ConversationAnalysisPanel analysis={baseAnalysis} isLoading={false} onReanalyze={vi.fn()} leadName="Gloria" />
    );

    const textarea = screen.getByDisplayValue('¿Te queda mejor el de 08:30 o el de 13:30?') as HTMLTextAreaElement;
    await act(async () => {
      fireEvent.change(textarea, { target: { value: 'edição local, ainda não salva' } });
    });

    rerender(
      <ConversationAnalysisPanel
        analysis={{ ...baseAnalysis, suggestedSmartReply: 'Nova sugestão depois de reanalisar' }}
        isLoading={false}
        onReanalyze={vi.fn()}
        leadName="Gloria"
      />
    );

    expect(screen.getByDisplayValue('Nova sugestão depois de reanalisar')).not.toBeNull();
    expect(screen.queryByDisplayValue('edição local, ainda não salva')).toBeNull();
  });
});
