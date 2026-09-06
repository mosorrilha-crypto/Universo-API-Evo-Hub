// @vitest-environment jsdom
/**
 * TASK-0328 (pedido direto, print anotado do cabeçalho): idioma (PT/ES) e
 * tema saíram do cabeçalho global (Header.tsx) e vieram pra dentro da
 * gaveta "Ferramentas" do Atendimento, discretos igual "Status do agente".
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

    await waitFor(() => expect(screen.getByText('Idioma e tema')).not.toBeNull());

    await act(async () => {
      fireEvent.click(screen.getByTitle('Español'));
    });
    expect(document.documentElement.lang).toBe('es-PY');

    await act(async () => {
      fireEvent.click(screen.getByTitle('Claro'));
    });
    expect(document.documentElement.dataset.theme).toBe('light');
  });
});
