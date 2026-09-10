// @vitest-environment jsdom
/**
 * Achado real em produção (pedido direto, print): mensagem nova do cliente
 * só aparecia na conversa aberta depois de sair e voltar pra ela — nunca em
 * tempo real via SSE.
 *
 * Causa raiz: `source.onmessage` (handler do EventSource) mora dentro de um
 * `useEffect` cuja lista de dependências é só `[activeTenant.id]` — de
 * propósito, pra não reabrir a conexão a cada mudança de `leads`. Isso
 * significa que o closure desse handler (e de tudo que ele chama, incluindo
 * `loadNewerMessages`) fica preso pro `leads` de quando o efeito rodou pela
 * ÚLTIMA vez (normalmente logo no mount, quando `leads` ainda está vazio).
 * `loadNewerMessages` lia `leads.find(...)` direto desse closure velho —
 * achava `undefined` ou um lead sem `historyLoaded`, e saía sem fazer nada,
 * sem erro nenhum. Reabrir a conversa "consertava" porque `handleSelectLead`
 * é recriado a cada render, com o `leads` de verdade.
 *
 * Corrigido com `leadsRef` (mesmo padrão já usado por `activeTenantIdRef`):
 * uma ref sempre sincronizada com o estado, lida por `loadNewerMessages` em
 * vez do `leads` fechado no closure do efeito do SSE.
 */
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WhatsAppLeadsSim } from '../WhatsAppLeadsSim';
import { emptyKnowledgeBase } from '../AgentKnowledgeBase';
import { AppPreferencesProvider } from '../../contexts/AppPreferencesContext';
import { INITIAL_TENANTS } from '../../data/mockTenants';

const PHONE = '5511900000099';
const NOW = new Date();
const FIRST_MSG_TS = new Date(NOW.getTime() - 5 * 60 * 1000).toISOString();
const NEW_MSG_TS = new Date(NOW.getTime() - 1000).toISOString();

const jsonResponse = (body: unknown, ok = true) => ({
  ok,
  status: ok ? 200 : 500,
  json: async () => body,
} as Response);

vi.mock('../../lib/apiClient', () => ({
  apiFetch: vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.startsWith('/api/conversations?archived=true')) {
      return jsonResponse({
        conversations: [
          {
            phone: PHONE,
            name: 'Cinthia',
            messages: [{ id: 'm1', sender: 'lead', text: 'Oi', timestamp: FIRST_MSG_TS }],
            lastMessageId: 'm1',
            lastMessageSender: 'lead',
            updatedAt: FIRST_MSG_TS,
            unreadCount: 0,
            lastLeadMessageAt: FIRST_MSG_TS,
          },
        ],
      });
    }
    if (url.startsWith(`/api/conversations/${PHONE}/messages?limit=30`)) {
      return jsonResponse({
        messages: [{ id: 'm1', sender: 'lead', text: 'Oi', timestamp: FIRST_MSG_TS }],
        hasMore: false,
      });
    }
    if (url.startsWith(`/api/conversations/${PHONE}/messages?after=`)) {
      return jsonResponse({
        messages: [{ id: 'm2', sender: 'lead', text: 'Mensagem nova via SSE', timestamp: NEW_MSG_TS }],
      });
    }
    return jsonResponse({}, false);
  }),
  getTenantOverride: () => null,
}));

if (!Element.prototype.scrollTo) {
  Element.prototype.scrollTo = vi.fn();
}

// Diferente do stub inofensivo de outros testes (só `close()`), este guarda
// a última instância criada — o teste precisa disparar `onmessage` nela pra
// simular o evento real que o servidor manda quando chega mensagem nova.
let lastEventSourceInstance: FakeEventSource | undefined;
class FakeEventSource {
  onmessage: ((event: { data: string }) => void) | null = null;
  constructor() {
    lastEventSourceInstance = this;
  }
  close() {}
}
vi.stubGlobal('EventSource', FakeEventSource as any);

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  lastEventSourceInstance = undefined;
});

describe('WhatsAppLeadsSim — mensagem nova via SSE na conversa aberta', () => {
  it('aparece sem precisar sair e reabrir a conversa', async () => {
    render(
      <AppPreferencesProvider>
        <WhatsAppLeadsSim onSaveTranscript={vi.fn()} activeTenant={INITIAL_TENANTS[0]} knowledgeBase={emptyKnowledgeBase} />
      </AppPreferencesProvider>
    );

    await waitFor(() => expect(screen.getAllByText('Cinthia').length).toBeGreaterThan(0));

    // Abre a conversa de verdade (handleSelectLead) — carrega o histórico
    // (`historyLoaded` vira true) e marca `activeLeadPhoneRef`.
    await act(async () => {
      fireEvent.click(screen.getAllByText('Cinthia')[0]);
    });
    await screen.findByText('Oi');

    expect(lastEventSourceInstance).toBeDefined();
    expect(lastEventSourceInstance?.onmessage).toBeTypeOf('function');

    // Simula o evento real que o servidor manda quando o cliente escreve de
    // novo, com a conversa já aberta — mesmo cenário do print reportado.
    await act(async () => {
      lastEventSourceInstance?.onmessage?.({ data: JSON.stringify({ phone: PHONE }) });
    });

    await screen.findByText('Mensagem nova via SSE');
  });
});
