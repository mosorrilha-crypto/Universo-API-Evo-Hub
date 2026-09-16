// @vitest-environment jsdom
/**
 * Achado real, pedido direto (print anotado, 16/09/2026, tema claro no
 * mobile): as fileiras "ESPERANDO HÁ MAIS DE 30 MIN"/"ESPERANDO ATÉ 30 MIN"
 * usavam hex fixo (`bg-[#231412]`/`bg-[#231C10]`) — os valores de
 * --danger-surface/--pending-surface só do tema ESCURO, hardcoded — em vez
 * dos tokens `var(--danger-surface)`/`var(--pending-surface)`. Resultado: em
 * qualquer outro tema (claro, azul, limpo) a fileira ficava sempre quase
 * preta, destoando do resto da paleta ("tarja preta"). Este teste cobre o
 * fix: a classe agora referencia os tokens (que o CSS já resolve por tema),
 * nunca mais um hex fixo.
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

const RECENT_UNANSWERED = new Date(Date.now() - 5 * 60 * 1000).toISOString();

vi.mock('../../lib/apiClient', () => ({
  apiFetch: vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.startsWith('/api/conversations?archived=true')) {
      return jsonResponse({
        conversations: [
          {
            phone: '5511900000001',
            name: 'Aguardando Resposta',
            messages: [{ id: 'm1', sender: 'lead', text: 'Oi, alguém aí?', timestamp: RECENT_UNANSWERED }],
            lastMessageId: 'm1',
            lastMessageSender: 'lead',
            updatedAt: RECENT_UNANSWERED,
            unreadCount: 1,
            lastLeadMessageAt: RECENT_UNANSWERED,
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

describe('WhatsAppLeadsSim — fileiras de espera usam tokens de tema (não hex fixo)', () => {
  it('a fileira "ESPERANDO ATÉ 30 MIN" referencia var(--pending)/var(--pending-surface), nunca um hex fixo', async () => {
    render(
      <AppPreferencesProvider>
        <WhatsAppLeadsSim onSaveTranscript={vi.fn()} activeTenant={INITIAL_TENANTS[0]} knowledgeBase={emptyKnowledgeBase} />
      </AppPreferencesProvider>
    );

    await waitFor(() => expect(screen.getAllByText('Aguardando Resposta').length).toBeGreaterThan(0));

    const section = screen.getByLabelText('ESPERANDO ATÉ 30 MIN');
    const header = section.querySelector('[class*="text-"]') as HTMLElement;
    expect(header).not.toBeNull();
    expect(header.className).toContain('text-[var(--pending)]');
    expect(header.className).toContain('bg-[var(--pending-surface)]');
    expect(header.className).not.toContain('#231C10');
    expect(header.className).not.toContain('#8A5A00');
  });
});
