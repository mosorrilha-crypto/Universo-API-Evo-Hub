// @vitest-environment jsdom
/**
 * TASK-0336 (pedido direto, print anotado do celular):
 * 1. O card de aviso "mais de 24h sem responder" (canal não-Meta) não tinha
 *    como fechar — ganhou um X.
 * 2. Bug real: o botão "Conversas" da barra inferior tinha "is-active" fixo
 *    no className, ficando destacado junto com "Ferramentas" sempre que a
 *    gaveta abria — agora só um dos dois fica ativo por vez.
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

const PHONE = '5511900000009';
const WINDOW_EXPIRED_AT = new Date(Date.now() - 60 * 60 * 1000).toISOString();

vi.mock('../../lib/apiClient', () => ({
  apiFetch: vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.startsWith('/api/conversations?archived=true')) {
      const outside24h = new Date(Date.now() - 30 * 60 * 60 * 1000).toISOString();
      return jsonResponse({
        conversations: [
          {
            // Sem `phoneNumberId` — canal não-Meta (Evolution/Baileys),
            // exatamente o caso que renderiza o card amber dispensável (a
            // Meta tem outro card, sem X, porque ali é bloqueio real de
            // envio, não um aviso de risco).
            phone: PHONE,
            name: 'Cliente Fora Da Janela',
            messages: [{ id: 'm1', sender: 'lead', text: 'Oi', timestamp: outside24h }],
            lastMessageId: 'm1',
            lastMessageSender: 'lead',
            updatedAt: outside24h,
            unreadCount: 0,
            lastLeadMessageAt: outside24h,
          },
        ],
      });
    }
    if (url.startsWith(`/api/conversations/${PHONE}/context`)) {
      return jsonResponse({
        available: true,
        unavailable: { memory: false, trace: false },
        memory: null,
        latestDecision: null,
        serviceWindow: {
          withinWindow: false,
          hoursRemaining: 0,
          lastLeadMessageAt: new Date(Date.now() - 30 * 60 * 60 * 1000).toISOString(),
          windowExpiresAt: WINDOW_EXPIRED_AT,
        },
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

describe('WhatsAppLeadsSim — aviso de janela de 24h (canal não-Meta) e nav inferior', () => {
  it('deixa fechar o aviso de retomada com o X, sem afetar o botão de sugestão', async () => {
    render(
      <AppPreferencesProvider>
        <WhatsAppLeadsSim onSaveTranscript={vi.fn()} activeTenant={INITIAL_TENANTS[0]} knowledgeBase={emptyKnowledgeBase} />
      </AppPreferencesProvider>
    );

    await waitFor(() => expect(screen.getByText(/Mais de 24h sem Cliente Fora Da Janela escrever/)).not.toBeNull());
    expect(screen.getByText('Sugerir mensagem de retomada')).not.toBeNull();

    await act(async () => {
      fireEvent.click(screen.getByTitle('Fechar este aviso'));
    });

    expect(screen.queryByText(/Mais de 24h sem Cliente Fora Da Janela escrever/)).toBeNull();
  });

  it('só destaca "Conversas" quando a gaveta Ferramentas está fechada', async () => {
    render(
      <AppPreferencesProvider>
        <WhatsAppLeadsSim onSaveTranscript={vi.fn()} activeTenant={INITIAL_TENANTS[0]} knowledgeBase={emptyKnowledgeBase} />
      </AppPreferencesProvider>
    );

    // O nome aparece 2x quando a conversa já vem auto-selecionada (linha da
    // lista + cabeçalho da conversa aberta) — mesmo padrão já documentado
    // no teste de filtro de janela (WhatsAppLeadsSim.windowFilter.test.tsx).
    await waitFor(() => expect(screen.getAllByText('Cliente Fora Da Janela').length).toBeGreaterThan(0));

    const nav = screen.getByLabelText('Navegação do Atendimento');
    const conversasButton = within(nav).getByText('Conversas').closest('button')!;
    const ferramentasButton = within(nav).getByText('Ferramentas').closest('button')!;

    expect(conversasButton.className).toContain('is-active');
    expect(ferramentasButton.className).not.toContain('is-active');

    await act(async () => {
      fireEvent.click(ferramentasButton);
    });

    expect(conversasButton.className).not.toContain('is-active');
    expect(ferramentasButton.className).toContain('is-active');

    await act(async () => {
      fireEvent.click(conversasButton);
    });

    expect(conversasButton.className).toContain('is-active');
    expect(ferramentasButton.className).not.toContain('is-active');
  });
});
