// @vitest-environment jsdom
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

// Achado real desta tarefa (04/09/2026, pedido direto): o filtro de janela
// de 24h (funil ao lado do ícone de Status, abrindo "Dentro das 24h"/"Fora
// das 24h") e a correção de staleness do badge/gating da janela dependem
// de `leads` — estado 100% interno, populado só via GET /api/conversations
// (não existe prop de injeção nem mock local desde a remoção do cache em
// localStorage por PII, ver comentário na declaração de `leads`). Por isso
// este teste intercepta apiFetch em vez de passar `leads` como prop.
// `windowExpiresAt` já no passado, mas `withinWindow` deliberadamente `true`
// (o valor que o SERVIDOR devolveu no momento do fetch, potencialmente
// desatualizado se o operador ficou com a conversa aberta) — simula
// exatamente o cenário do bug de staleness relatado: se o componente ainda
// confiasse em `serviceWindow.withinWindow` puro, o badge continuaria
// mostrando janela aberta mesmo com `windowExpiresAt` no passado.
const STALE_WINDOW_EXPIRES_AT = new Date(Date.now() - 60 * 1000).toISOString();

vi.mock('../../lib/apiClient', () => ({
  apiFetch: vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.startsWith('/api/conversations?archived=true')) {
      const now = new Date();
      const within24h = new Date(now.getTime() - 2 * 60 * 60 * 1000).toISOString();
      const outside24h = new Date(now.getTime() - 30 * 60 * 60 * 1000).toISOString();
      return jsonResponse({
        conversations: [
          {
            phone: '5511900000001',
            name: 'Dentro da Janela',
            messages: [{ id: 'm1', sender: 'lead', text: 'Oi', timestamp: within24h }],
            lastMessageId: 'm1',
            lastMessageSender: 'lead',
            updatedAt: within24h,
            unreadCount: 0,
            lastLeadMessageAt: within24h,
            phoneNumberId: 'meta-phone-1',
          },
          {
            phone: '5511900000002',
            name: 'Fora da Janela',
            messages: [{ id: 'm2', sender: 'lead', text: 'Oi de novo', timestamp: outside24h }],
            lastMessageId: 'm2',
            lastMessageSender: 'lead',
            updatedAt: outside24h,
            unreadCount: 0,
            lastLeadMessageAt: outside24h,
          },
        ],
      });
    }
    if (url.startsWith('/api/conversations/5511900000001/context')) {
      return jsonResponse({
        available: true,
        unavailable: { memory: false, trace: false },
        memory: null,
        latestDecision: null,
        serviceWindow: {
          withinWindow: true,
          hoursRemaining: 5,
          lastLeadMessageAt: new Date(Date.now() - 19 * 60 * 60 * 1000).toISOString(),
          windowExpiresAt: STALE_WINDOW_EXPIRES_AT,
        },
      });
    }
    // Qualquer outro endpoint (templates de reengajamento, status do agente,
    // etc.): resposta neutra, sem crashar.
    return jsonResponse({}, false);
  }),
  getAuthToken: () => null,
  getTenantOverride: () => null,
}));

// jsdom não implementa Element.scrollTo — a conversa recém-aberta chama isso
// num requestAnimationFrame (scrollToLatestMessage) pra rolar até a última
// mensagem, o que não existe de verdade nesta suíte de teste.
if (!Element.prototype.scrollTo) {
  Element.prototype.scrollTo = vi.fn();
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('WhatsAppLeadsSim — filtro de janela de 24h (ícone + lista)', () => {
  it('mostra as contagens corretas de "Dentro"/"Fora das 24h" e filtra a lista ao escolher uma opção', async () => {
    render(
      <AppPreferencesProvider>
        <WhatsAppLeadsSim onSaveTranscript={vi.fn()} activeTenant={INITIAL_TENANTS[0]} knowledgeBase={emptyKnowledgeBase} />
      </AppPreferencesProvider>
    );

    // O primeiro lead da resposta é selecionado automaticamente (conversa
    // aberta), então o nome aparece 2x: na linha da lista e no cabeçalho da
    // conversa — por isso getAllByText/queryAllByText em vez de getByText.
    await waitFor(() => expect(screen.getAllByText('Dentro da Janela').length).toBeGreaterThan(0));
    expect(screen.getAllByText('Fora da Janela').length).toBeGreaterThan(0);

    const filterButton = screen.getByTitle('Filtrar por janela de atendimento de 24h');
    await act(async () => {
      fireEvent.click(filterButton);
    });

    const withinOption = await screen.findByTitle(
      'Contatos com mensagem do cliente nas últimas 24h — o agente/operador ainda pode responder normalmente.'
    );
    const outsideOption = screen.getByTitle(
      'Contatos sem mensagem do cliente há mais de 24h — na Meta isso exige modelo aprovado pra reabrir; no Evolution não é uma restrição técnica, mas reengajar aumenta o risco de o número ser sinalizado.'
    );
    expect(withinOption.textContent).toContain('Dentro das 24h');
    expect(withinOption.textContent).toContain('1');
    expect(outsideOption.textContent).toContain('Fora das 24h');
    expect(outsideOption.textContent).toContain('1');

    await act(async () => {
      fireEvent.click(withinOption);
    });

    // Dropdown fecha sozinho ao escolher uma opção.
    expect(screen.queryByTitle('Contatos com mensagem do cliente nas últimas 24h — o agente/operador ainda pode responder normalmente.')).toBeNull();

    // Lista fica só com o lead dentro da janela (o cabeçalho da conversa
    // aberta ainda mostra o nome também, por isso getAllByText).
    expect(screen.getAllByText('Dentro da Janela').length).toBeGreaterThan(0);
    expect(screen.queryAllByText('Fora da Janela').length).toBe(0);
  });

  it('fecha o dropdown ao clicar fora, sem alterar o filtro ativo', async () => {
    render(
      <AppPreferencesProvider>
        <WhatsAppLeadsSim onSaveTranscript={vi.fn()} activeTenant={INITIAL_TENANTS[0]} knowledgeBase={emptyKnowledgeBase} />
      </AppPreferencesProvider>
    );

    await waitFor(() => expect(screen.getAllByText('Dentro da Janela').length).toBeGreaterThan(0));

    const filterButton = screen.getByTitle('Filtrar por janela de atendimento de 24h');
    await act(async () => {
      fireEvent.click(filterButton);
    });
    await screen.findByTitle(
      'Contatos com mensagem do cliente nas últimas 24h — o agente/operador ainda pode responder normalmente.'
    );

    // Overlay "fixed inset-0" usado pra fechar ao clicar fora (mesmo padrão
    // já usado no menu ⋮ do cabeçalho da conversa, isHeaderMenuOpen).
    const overlay = document.querySelector('.fixed.inset-0.z-40');
    expect(overlay).not.toBeNull();
    await act(async () => {
      fireEvent.click(overlay as Element);
    });

    expect(screen.queryByTitle('Contatos com mensagem do cliente nas últimas 24h — o agente/operador ainda pode responder normalmente.')).toBeNull();
    // Ambos os leads continuam visíveis — clicar fora não aplicou nenhum filtro.
    await waitFor(() => {
      expect(screen.getAllByText('Dentro da Janela').length).toBeGreaterThan(0);
      expect(screen.getAllByText('Fora da Janela').length).toBeGreaterThan(0);
    });
  });

  it('usa windowExpiresAt (não o withinWindow congelado do servidor) pra decidir se a janela está aberta', async () => {
    render(
      <AppPreferencesProvider>
        <WhatsAppLeadsSim onSaveTranscript={vi.fn()} activeTenant={INITIAL_TENANTS[0]} knowledgeBase={emptyKnowledgeBase} />
      </AppPreferencesProvider>
    );

    // "Dentro da Janela" (5511900000001) é selecionado automaticamente por
    // ser o primeiro da lista, disparando o fetch de /context com o
    // serviceWindow "stale" (withinWindow: true, mas windowExpiresAt já no
    // passado) mockado acima.
    await waitFor(() => expect(screen.getAllByText('Dentro da Janela').length).toBeGreaterThan(0));

    // Badge "Xh" do cabeçalho (TASK-0258) só aparece quando a janela está
    // aberta — com a correção, não deve aparecer, mesmo o servidor tendo
    // respondido withinWindow: true.
    await waitFor(() => {
      expect(screen.queryByTitle(/O agente pode responder normalmente/)).toBeNull();
    });

    // Card de janela fechada (canal Meta, phoneNumberId presente) deve
    // aparecer em vez disso, oferecendo só modelo aprovado.
    await screen.findByText('Janela de 24 horas fechou. Só é permitido enviar modelo aprovado.');
  });
});
