// @vitest-environment jsdom
/**
 * TASK-0395 (bug real reportado com print, 11/09/2026): na gaveta
 * "Ferramentas" do mobile, o botão que abre o modal de "Gatilhos de
 * Anúncio" só existia quando `adTriggerMessages.length > 0` — ou seja,
 * quem ligava "Anúncios" pela primeira vez (nenhum gatilho cadastrado
 * ainda) não tinha NENHUM jeito de cadastrar o primeiro pelo celular. A
 * versão desktop da mesma engrenagem sempre usou `adsOnly` como condição,
 * nunca a contagem — este teste cobre o fix que alinha o mobile ao mesmo
 * comportamento.
 */
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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

let mockAdTriggerMessages: string[] = [];

vi.mock('../../lib/apiClient', () => ({
  apiFetch: vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.startsWith('/api/conversations?archived=true')) {
      return jsonResponse({ conversations: [] });
    }
    if (url.startsWith('/api/agent-status') && (!init || !init.method || init.method === 'GET')) {
      return jsonResponse({ status: 'active', adsOnly: true, adTriggerMessages: mockAdTriggerMessages });
    }
    return jsonResponse({}, false);
  }),
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
});

async function renderAndOpenFerramentas() {
  render(
    <AppPreferencesProvider>
      <WhatsAppLeadsSim onSaveTranscript={vi.fn()} activeTenant={INITIAL_TENANTS[0]} knowledgeBase={emptyKnowledgeBase} canManageAgent />
    </AppPreferencesProvider>
  );
  await waitFor(() => expect(screen.getAllByText('Selecione uma conversa para visualizar no WhatsApp Web.').length).toBeGreaterThan(0));
  const nav = screen.getByLabelText('Navegação do Atendimento');
  const ferramentasButton = within(nav).getByText('Ferramentas').closest('button')!;
  await act(async () => {
    fireEvent.click(ferramentasButton);
  });
  await waitFor(() => expect(screen.getAllByText('Anúncios').length).toBeGreaterThan(0));
}

describe('WhatsAppLeadsSim — gaveta Ferramentas (mobile), entrada pra configurar gatilhos de anúncio', () => {
  it('mostra o botão de configurar gatilhos mesmo sem nenhum gatilho cadastrado ainda (adsOnly ligado)', async () => {
    mockAdTriggerMessages = [];
    await renderAndOpenFerramentas();

    await waitFor(() => expect(screen.queryByTitle('Configurar gatilhos de anúncio')).not.toBeNull());
    expect(screen.queryByTitle('Ver gatilhos de anúncio configurados')).toBeNull();
  });

  it('mostra a contagem como badge quando já existem gatilhos cadastrados', async () => {
    mockAdTriggerMessages = ['Vim pelo anúncio, quero agendar'];
    await renderAndOpenFerramentas();

    await waitFor(() => expect(screen.queryByTitle('Ver gatilhos de anúncio configurados')).not.toBeNull());
    expect(screen.queryByTitle('Configurar gatilhos de anúncio')).toBeNull();
  });
});
