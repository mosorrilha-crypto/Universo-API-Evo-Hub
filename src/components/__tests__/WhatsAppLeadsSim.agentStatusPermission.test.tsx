// @vitest-environment jsdom
import React from 'react';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WhatsAppLeadsSim } from '../WhatsAppLeadsSim';
import { emptyKnowledgeBase } from '../AgentKnowledgeBase';
import { AppPreferencesProvider } from '../../contexts/AppPreferencesContext';
import { INITIAL_TENANTS } from '../../data/mockTenants';

// Bug real reportado (09/09/2026, print de um operador logado): os pills
// "Ativo"/"Restrito"/"Pausado" (faixa "Status do agente") renderizavam
// incondicionalmente pra QUALQUER role, mesmo sem `canManageAgent` (gate
// admin/saas_admin já usado pro tile "Agente & catálogo"). O backend sempre
// bloqueou `POST /api/agent-status` com `requireRole('admin')`
// (server/routes/conversations.ts) — mas o clique fazia uma atualização
// OTIMISTA na UI antes do servidor rejeitar, dando a impressão enganosa de
// que um operador conseguiu mudar o status. Este teste cobre o fix: a faixa
// só aparece quando `canManageAgent` é true.
const jsonResponse = (body: unknown, ok = true) => ({
  ok,
  status: ok ? 200 : 500,
  json: async () => body,
} as Response);

vi.mock('../../lib/apiClient', () => ({
  apiFetch: vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.startsWith('/api/conversations?archived=true')) {
      return jsonResponse({ conversations: [] });
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

describe('WhatsAppLeadsSim — faixa "Status do agente" respeita canManageAgent', () => {
  it('não renderiza os pills de status pra um usuário sem canManageAgent (operator/manager)', async () => {
    render(
      <AppPreferencesProvider>
        <WhatsAppLeadsSim onSaveTranscript={vi.fn()} activeTenant={INITIAL_TENANTS[0]} knowledgeBase={emptyKnowledgeBase} />
      </AppPreferencesProvider>
    );

    await waitFor(() => expect(screen.getAllByText('Selecione uma conversa para visualizar no WhatsApp Web.').length).toBeGreaterThan(0));
    expect(screen.queryByText('Status do agente')).toBeNull();
    expect(screen.queryByText('Ativo')).toBeNull();
    expect(screen.queryByText('Pausado')).toBeNull();
  });

  it('renderiza os pills de status pra um usuário com canManageAgent (admin/saas_admin)', async () => {
    render(
      <AppPreferencesProvider>
        <WhatsAppLeadsSim
          onSaveTranscript={vi.fn()}
          activeTenant={INITIAL_TENANTS[0]}
          knowledgeBase={emptyKnowledgeBase}
          canManageAgent
        />
      </AppPreferencesProvider>
    );

    await waitFor(() => expect(screen.getAllByText('Status do agente').length).toBeGreaterThan(0));
    expect(screen.getAllByText('Ativo').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Pausado').length).toBeGreaterThan(0);
  });
});
