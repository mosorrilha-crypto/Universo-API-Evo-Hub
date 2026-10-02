// @vitest-environment jsdom
/**
 * Achado real, pedido direto ("o aplicativo está um pouco lento e
 * travando" + "pode aplicar o segundo" = virtualização, fase 2). Com até
 * ~560 conversas em produção, renderizar TODAS as linhas no DOM de uma vez
 * só custa memória/pintura mesmo fora da área visível.
 *
 * Decisão de escopo (ver comentário em WhatsAppLeadsSim.tsx, perto de
 * `visibleConversationCount`): virtualização de verdade (posicionamento
 * absoluto + medição de altura por linha, já que etiquetas podem quebrar em
 * mais de uma linha) foi avaliada e descartada — sem navegador real pra
 * validar visualmente neste sandbox, o risco de sobrepor/cortar conteúdo na
 * tela mais usada do sistema não compensa. Em vez disso: carrega um lote
 * inicial (60) + mais conforme o operador rola a lista pra baixo, mesmo
 * padrão de "infinite scroll" já usado no histórico de mensagens.
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

const LEAD_COUNT = 150;

let leadListRowRenderedIds: Set<string>;
vi.mock('../chat/LeadListRow', () => ({
  LeadListRow: (props: { lead: { id: string; name: string } }) => {
    leadListRowRenderedIds.add(props.lead.id);
    return React.createElement('div', { 'data-lead-id': props.lead.id }, props.lead.name);
  },
}));

vi.mock('../../lib/apiClient', () => ({
  apiFetch: vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.startsWith('/api/conversations?archived=true')) {
      const conversations = Array.from({ length: LEAD_COUNT }, (_, i) => ({
        phone: `59598400${String(i).padStart(4, '0')}`,
        name: `Lead ${String(i).padStart(3, '0')}`,
        messages: [{ id: `m${i}`, sender: 'lead', text: 'Oi', timestamp: new Date(Date.now() - i * 1000).toISOString() }],
        lastMessageId: `m${i}`,
        lastMessageSender: 'lead',
        updatedAt: new Date(Date.now() - i * 1000).toISOString(),
        unreadCount: 0,
        lastLeadMessageAt: new Date(Date.now() - i * 1000).toISOString(),
      }));
      return jsonResponse({ conversations });
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

function scrollListToBottom(container: Element) {
  Object.defineProperty(container, 'scrollHeight', { value: 100000, configurable: true });
  Object.defineProperty(container, 'clientHeight', { value: 800, configurable: true });
  Object.defineProperty(container, 'scrollTop', { value: 99500, configurable: true });
  fireEvent.scroll(container);
}

describe('WhatsAppLeadsSim — carregamento progressivo da lista de conversas', () => {
  it('renderiza só o primeiro lote (60) de ~150 conversas, e carrega mais ao rolar até perto do fim', async () => {
    leadListRowRenderedIds = new Set();
    const { container } = render(
      <AppPreferencesProvider>
        <WhatsAppLeadsSim onSaveTranscript={vi.fn()} activeTenant={INITIAL_TENANTS[0]} knowledgeBase={emptyKnowledgeBase} />
      </AppPreferencesProvider>
    );

    await waitFor(() => expect(screen.getAllByText('Lead 000').length).toBeGreaterThan(0));

    // Primeiro lote: só as 60 primeiras conversas (mais recentes primeiro)
    // devem ter sido renderizadas — nenhuma das últimas (ex: "Lead 149").
    expect(leadListRowRenderedIds.size).toBe(60);
    expect(screen.queryByText('Lead 149')).toBeNull();

    const scrollContainer = container.querySelector('.overflow-y-auto.divide-y') as HTMLElement;
    expect(scrollContainer).not.toBeNull();

    scrollListToBottom(scrollContainer);
    await waitFor(() => expect(leadListRowRenderedIds.size).toBe(120));

    scrollListToBottom(scrollContainer);
    await waitFor(() => expect(leadListRowRenderedIds.size).toBe(150));

    // Rolar de novo no fim não deve tentar passar do total real de conversas.
    scrollListToBottom(scrollContainer);
    expect(leadListRowRenderedIds.size).toBe(150);
  });
});
