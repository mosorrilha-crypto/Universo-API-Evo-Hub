// @vitest-environment jsdom
/**
 * Achado real, pedido direto ("o aplicativo está um pouco lento e
 * travando. O que pode estar causando isso?"): a lista de conversas
 * (filteredLeads/archivedLeads + as linhas renderizadas) era recalculada do
 * zero a CADA renderização do componente, mesmo quando nada na lista
 * mudou — ex: cada letra digitada no campo de resposta (setInputMessage,
 * mesmo componente) reconstruía as até ~560 linhas da lista à toa. Corrigido
 * com useMemo (filteredLeads/archivedLeads pelo array `leads`, e as linhas
 * já renderizadas por quem está selecionado/piscando/com o menu ⋮ aberto).
 * Este teste confirma que digitar no composer NÃO re-renderiza as linhas da
 * lista de conversas.
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

const PHONE = '595983000001';
const LEAD_COUNT = 30;

let leadListRowRenderCount = 0;
vi.mock('../chat/LeadListRow', () => ({
  LeadListRow: (props: { lead: { id: string; name: string }; onSelect: () => void }) => {
    leadListRowRenderCount += 1;
    return React.createElement('div', { onClick: props.onSelect, 'data-lead-id': props.lead.id }, props.lead.name);
  },
}));

vi.mock('../../lib/apiClient', () => ({
  apiFetch: vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.startsWith('/api/conversations?archived=true')) {
      const conversations = Array.from({ length: LEAD_COUNT }, (_, i) => ({
        phone: `59598300${String(i).padStart(4, '0')}`,
        name: `Cliente ${i}`,
        messages: [{ id: `m${i}`, sender: 'lead', text: 'Oi', timestamp: new Date().toISOString() }],
        lastMessageId: `m${i}`,
        lastMessageSender: 'lead',
        updatedAt: new Date().toISOString(),
        unreadCount: 0,
        lastLeadMessageAt: new Date().toISOString(),
      }));
      return jsonResponse({ conversations });
    }
    if (url === `/api/conversations/${PHONE}/messages?limit=30`) {
      return jsonResponse({ messages: [{ id: 'm0', sender: 'lead', text: 'Oi', timestamp: new Date().toISOString() }], hasMore: false });
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
  leadListRowRenderCount = 0;
});

describe('WhatsAppLeadsSim — lista de conversas memoizada (não recalcula ao digitar)', () => {
  it('digitar no campo de resposta não re-renderiza as linhas da lista de conversas', async () => {
    render(
      <AppPreferencesProvider>
        <WhatsAppLeadsSim onSaveTranscript={vi.fn()} activeTenant={INITIAL_TENANTS[0]} knowledgeBase={emptyKnowledgeBase} />
      </AppPreferencesProvider>
    );

    await waitFor(() => expect(screen.getAllByText('Cliente 0').length).toBeGreaterThan(0));
    fireEvent.click(screen.getAllByText('Cliente 0')[0]);

    const textarea = await screen.findByPlaceholderText('Digitar resposta...');

    const renderCountAfterSelect = leadListRowRenderCount;
    expect(renderCountAfterSelect).toBeGreaterThan(0);

    fireEvent.change(textarea, { target: { value: 'O' } });
    fireEvent.change(textarea, { target: { value: 'Oi' } });
    fireEvent.change(textarea, { target: { value: 'Oi,' } });
    fireEvent.change(textarea, { target: { value: 'Oi, t' } });
    fireEvent.change(textarea, { target: { value: 'Oi, tudo bem?' } });

    expect(leadListRowRenderCount).toBe(renderCountAfterSelect);
  });
});
