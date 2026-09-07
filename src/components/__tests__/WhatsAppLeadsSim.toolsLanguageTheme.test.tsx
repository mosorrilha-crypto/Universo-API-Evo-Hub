// @vitest-environment jsdom
/**
 * TASK-0328 (pedido direto, print anotado do cabeçalho): idioma (PT/ES) e
 * tema saíram do cabeçalho global (Header.tsx) e vieram pra dentro da
 * gaveta "Ferramentas" do Atendimento, discretos igual "Status do agente".
 *
 * TASK-0336 (pedido direto, print anotado): idioma/tema deixaram de ser 2
 * fileiras de pills sempre abertas — cada um virou um ícone único (rótulo =
 * valor atual, ex: "PT"/"Escuro") que precisa ser tocado pra expandir as
 * opções antes de poder escolher outra.
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

    // Idioma vira um ícone único (rótulo = idioma atual, "PT") — precisa
    // tocar nele pra expandir as opções antes de poder escolher "Español".
    await waitFor(() => expect(screen.getByText('PT')).not.toBeNull());
    await act(async () => {
      fireEvent.click(screen.getByText('PT'));
    });
    await act(async () => {
      fireEvent.click(screen.getByTitle('Español'));
    });
    expect(document.documentElement.lang).toBe('es-PY');

    // Mesmo padrão pro tema (rótulo = tema atual, "Escuro" por padrão).
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
