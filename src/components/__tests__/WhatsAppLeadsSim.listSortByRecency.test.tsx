// @vitest-environment jsdom
/**
 * Achado real, pedido direto ("tira este filtro de 30min e ordena por
 * mensagem mais recentes primeiro"): a lista de conversas era dividida em 3
 * grupos fixos (esperando há mais de 30min / até 30min / aguardando
 * cliente), nessa ordem — uma conversa SEM ninguém esperando resposta
 * (última mensagem nossa) sempre caía no último grupo, mesmo que tivesse
 * atividade muito mais recente que uma conversa "esperando" há 20 minutos.
 * Removido o agrupamento: a lista agora é única, ordenada só por atividade
 * mais recente (fixadas continuam primeiro — comportamento separado, não
 * pedido pra mudar).
 */
import React from 'react';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
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

// "Recente Sem Resposta": última mensagem NOSSA (agent), 1 minuto atrás —
// no esquema antigo caía no grupo "aguardando cliente" (sempre por último).
const VERY_RECENT = new Date(Date.now() - 1 * 60 * 1000).toISOString();
// "Antiga Aguardando": última mensagem do CLIENTE, 20 minutos atrás — no
// esquema antigo caía no grupo "até 30 min" (sempre antes de "aguardando
// cliente"), apesar de ser mais antiga de verdade.
const OLDER_WAITING = new Date(Date.now() - 20 * 60 * 1000).toISOString();

vi.mock('../../lib/apiClient', () => ({
  apiFetch: vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.startsWith('/api/conversations?archived=true')) {
      return jsonResponse({
        conversations: [
          {
            phone: '5511900000001',
            name: 'Antiga Aguardando',
            messages: [{ id: 'm1', sender: 'lead', text: 'Oi, alguém aí?', timestamp: OLDER_WAITING }],
            lastMessageId: 'm1',
            lastMessageSender: 'lead',
            updatedAt: OLDER_WAITING,
            unreadCount: 1,
            lastLeadMessageAt: OLDER_WAITING,
          },
          {
            phone: '5511900000002',
            name: 'Recente Sem Resposta',
            messages: [{ id: 'm2', sender: 'agent', text: 'Já te retorno!', timestamp: VERY_RECENT }],
            lastMessageId: 'm2',
            lastMessageSender: 'agent',
            updatedAt: VERY_RECENT,
            unreadCount: 0,
          },
        ],
      });
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

describe('WhatsAppLeadsSim — lista de conversas ordenada só por atividade mais recente', () => {
  it('conversa mais recente (sem ninguém esperando) aparece ANTES de uma mais antiga esperando resposta, sem seções de espera', async () => {
    render(
      <AppPreferencesProvider>
        <WhatsAppLeadsSim onSaveTranscript={vi.fn()} activeTenant={INITIAL_TENANTS[0]} knowledgeBase={emptyKnowledgeBase} />
      </AppPreferencesProvider>
    );

    await waitFor(() => expect(screen.getAllByText('Recente Sem Resposta').length).toBeGreaterThan(0));
    await waitFor(() => expect(screen.getAllByText('Antiga Aguardando').length).toBeGreaterThan(0));

    expect(screen.queryByText(/ESPERANDO/i)).toBeNull();
    expect(screen.queryByText(/AGUARDANDO CLIENTE/i)).toBeNull();

    const recentPosition = screen.getAllByText('Recente Sem Resposta')[0].compareDocumentPosition(
      screen.getAllByText('Antiga Aguardando')[0]
    );
    // DOCUMENT_POSITION_FOLLOWING (4): "Antiga Aguardando" vem DEPOIS de
    // "Recente Sem Resposta" no DOM, ou seja, a mais recente está primeiro.
    expect(recentPosition & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});
