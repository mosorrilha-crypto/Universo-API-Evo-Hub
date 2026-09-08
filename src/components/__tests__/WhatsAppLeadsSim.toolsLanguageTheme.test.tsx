// @vitest-environment jsdom
/**
 * TASK-0328 (pedido direto, print anotado do cabeçalho): idioma (PT/ES) e
 * tema saíram do cabeçalho global (Header.tsx) e vieram pra dentro da
 * gaveta "Ferramentas" do Atendimento, discretos igual "Status do agente".
 *
 * TASK-0336 tinha colapsado idioma/tema num ícone único que precisava ser
 * tocado pra expandir. TASK-0341/0342 reverteram pra pills sempre visíveis.
 * TASK-0343 (pedido direto): meio-termo — a pill do valor ATUAL (idioma e
 * tema) fica sempre visível; tocar nela expande as outras opções como
 * pills de texto (não um ícone isolado, como era na TASK-0336).
 */
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WhatsAppLeadsSim } from '../WhatsAppLeadsSim';
import { emptyKnowledgeBase } from '../AgentKnowledgeBase';
import { AppPreferencesProvider } from '../../contexts/AppPreferencesContext';
import { INITIAL_TENANTS } from '../../data/mockTenants';

const jsonResponse = (body: unknown, ok = true) => ({
  ok,
  status: ok ? 200 : 500,
  json: async () => body,
} as Response);

vi.mock('../../lib/apiClient', () => ({
  apiFetch: vi.fn(async () => jsonResponse({}, false)),
  getTenantOverride: () => null,
}));

if (!Element.prototype.scrollTo) {
  Element.prototype.scrollTo = vi.fn();
}

class FakeEventSource {
  close() {}
}
vi.stubGlobal('EventSource', FakeEventSource as any);

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  try {
    localStorage.clear();
  } catch {
    // sem storage disponível no ambiente de teste — segue sem estado persistido.
  }
});

describe('WhatsAppLeadsSim — idioma e tema dentro da gaveta "Ferramentas"', () => {
  it('troca idioma e tema a partir da gaveta, sem depender do cabeçalho global', async () => {
    render(
      <AppPreferencesProvider>
        <WhatsAppLeadsSim onSaveTranscript={vi.fn()} activeTenant={INITIAL_TENANTS[0]} knowledgeBase={emptyKnowledgeBase} />
      </AppPreferencesProvider>
    );

    await waitFor(() => expect(screen.getByText('Ferramentas')).not.toBeNull());
    await act(async () => {
      fireEvent.click(screen.getByText('Ferramentas'));
    });

    // Idioma vira uma pill com o valor atual ("PT") — precisa tocar nela
    // pra expandir as opções antes de poder escolher "Español".
    await waitFor(() => expect(screen.getByText('PT')).not.toBeNull());
    await act(async () => {
      fireEvent.click(screen.getByText('PT'));
    });
    await act(async () => {
      fireEvent.click(screen.getByTitle('Español'));
    });
    expect(document.documentElement.lang).toBe('es-PY');

    // Mesmo padrão pro tema (pill com o valor atual, "Escuro" por padrão).
    await waitFor(() => expect(screen.getByText('Escuro')).not.toBeNull());
    await act(async () => {
      fireEvent.click(screen.getByText('Escuro'));
    });
    await act(async () => {
      fireEvent.click(screen.getByTitle('Claro'));
    });
    expect(document.documentElement.dataset.theme).toBe('light');
  });
});
