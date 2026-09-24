// @vitest-environment jsdom
/**
 * Pedido direto (print de referência do WhatsApp nativo): a data da
 * conversa deve ficar grudada no topo enquanto rola, não só aparecer uma
 * vez e sumir. A implementação usa `position: sticky` no pill de data —
 * jsdom não calcula layout real, então este teste confirma só o que dá pra
 * verificar sem um navegador de verdade: a classe `sticky` está presente em
 * cada separador e cada dia da conversa recebe o seu próprio separador.
 */
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
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

const PHONE = '595983087519';
const yesterday = new Date();
yesterday.setDate(yesterday.getDate() - 1);
yesterday.setHours(10, 0, 0, 0);
// Mensagens vêm da API com `timestamp` no formato ISO completo — é
// `formatMessagesForDisplay` (WhatsAppLeadsSim.tsx) quem deriva
// `rawTimestamp` (ISO cru, usado pelo separador de dia) e reformata
// `timestamp` pra "HH:MM" de exibição. Setar `rawTimestamp` aqui direto
// seria descartado por essa função.
const MESSAGES = [
  { id: 'm1', sender: 'lead', text: 'Mensagem de ontem', timestamp: yesterday.toISOString() },
  { id: 'm2', sender: 'agent', sentBy: 'ai', text: 'Mensagem de hoje', timestamp: new Date().toISOString() },
];

vi.mock('../../lib/apiClient', () => ({
  apiFetch: vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.startsWith('/api/conversations?archived=true')) {
      return jsonResponse({
        conversations: [{
          phone: PHONE,
          name: 'Cliente Teste Sticky',
          messages: MESSAGES,
          lastMessageId: 'm2',
          lastMessageSender: 'agent',
          updatedAt: new Date().toISOString(),
          unreadCount: 0,
          lastLeadMessageAt: yesterday.toISOString(),
        }],
      });
    }
    if (url === `/api/conversations/${PHONE}/messages?limit=30`) {
      return jsonResponse({ messages: MESSAGES, hasMore: false });
    }
    return jsonResponse({}, false);
  }),
  getTenantOverride: () => null,
}));

if (!Element.prototype.scrollTo) {
  Element.prototype.scrollTo = vi.fn();
}

class FakeEventSource {
  onmessage: ((event: { data: string }) => void) | null = null;
  close() {}
}
vi.stubGlobal('EventSource', FakeEventSource as any);

Object.defineProperty(window, 'innerWidth', { value: 1280, configurable: true });

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('WhatsAppLeadsSim — separador de data grudado no topo ao rolar', () => {
  it('renderiza um separador por dia, cada um com a classe sticky', async () => {
    render(
      <AppPreferencesProvider>
        <WhatsAppLeadsSim onSaveTranscript={vi.fn()} activeTenant={INITIAL_TENANTS[0]} knowledgeBase={emptyKnowledgeBase} />
      </AppPreferencesProvider>
    );

    await waitFor(() => expect(screen.getAllByText('Cliente Teste Sticky').length).toBeGreaterThan(0));
    fireEvent.click(screen.getAllByText('Cliente Teste Sticky')[0]);

    await screen.findByText('Ontem');
    const separators = await screen.findAllByRole('separator');
    const labels = separators.map((el) => el.getAttribute('aria-label'));

    expect(labels).toEqual(['Ontem', 'Hoje']);
    separators.forEach((el) => expect(el.className).toContain('sticky'));
  });
});
