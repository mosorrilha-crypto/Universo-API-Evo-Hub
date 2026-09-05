// @vitest-environment jsdom
/**
 * TASK-0292 (pedido direto, print da Ficha do Contato: "este campo não está
 * conectado a agenda, e eu não consigo editar pois a cliente remarcou") —
 * botão "Ressincronizar" no card AGENDAMENTOS, que corrige um agendamento
 * desatualizado (reagendado fora dos fluxos que escrevem em `appointments`)
 * chamando POST /api/conversations/:phone/appointment/resync.
 */
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

const PHONE = '5511900000009';
const STALE_START = '2026-08-15T10:00:00.000Z';
const CORRECTED_START = '2026-08-16T14:00:00.000Z';

let appointmentState = { summary: 'Cejas', startIso: STALE_START, endIso: '2026-08-15T11:00:00.000Z' };
const resyncMock = vi.fn(async () => jsonResponse({ appointment: { ...appointmentState, startIso: CORRECTED_START, endIso: '2026-08-16T15:00:00.000Z' }, changed: true }));

vi.mock('../../lib/apiClient', () => ({
  apiFetch: vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.startsWith('/api/conversations?archived=true')) {
      return jsonResponse({
        conversations: [
          {
            phone: PHONE,
            name: 'Cliente Remarcado',
            messages: [{ id: 'm1', sender: 'lead', text: 'Oi', timestamp: new Date().toISOString() }],
            lastMessageId: 'm1',
            lastMessageSender: 'lead',
            updatedAt: new Date().toISOString(),
            unreadCount: 0,
            lastLeadMessageAt: new Date().toISOString(),
          },
        ],
      });
    }
    if (url === `/api/conversations/${PHONE}/appointment/resync` && init?.method === 'POST') {
      return resyncMock();
    }
    if (url.startsWith(`/api/conversations/${PHONE}/appointment`)) {
      return jsonResponse({ appointment: appointmentState });
    }
    // Qualquer outro endpoint (contexto do lead, templates de reengajamento, status do agente): resposta neutra.
    return jsonResponse({}, false);
  }),
  getTenantOverride: () => null,
}));

if (!Element.prototype.scrollTo) {
  Element.prototype.scrollTo = vi.fn();
}

// TASK-0311 (TASK-0249 item 1): o SSE deixou de ser condicional a "havia
// token" (a sessão virou cookie httpOnly, invisível pro JS) — o componente
// sempre abre a conexão agora. jsdom 30 já implementa EventSource de
// verdade e tentaria conectar de fato nesta suíte; um stub inofensivo evita
// isso.
class FakeEventSource {
  close() {}
}
vi.stubGlobal('EventSource', FakeEventSource as any);

// showRightPanel (WhatsAppLeadsSim) só nasce `true` quando window.innerWidth
// >= 1200 no momento da montagem — jsdom usa 1024 por padrão, então a
// coluna 3 ("Ficha do Contato") nunca apareceria sem isso.
Object.defineProperty(window, 'innerWidth', { value: 1280, configurable: true });

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  appointmentState = { summary: 'Cejas', startIso: STALE_START, endIso: '2026-08-15T11:00:00.000Z' };
});

describe('WhatsAppLeadsSim — botão "Ressincronizar" da Ficha do Contato', () => {
  it('aparece quando há um agendamento vinculado e chama o endpoint de resync ao clicar', async () => {
    const onToast = vi.fn();
    render(
      <AppPreferencesProvider>
        <WhatsAppLeadsSim onSaveTranscript={vi.fn()} activeTenant={INITIAL_TENANTS[0]} knowledgeBase={emptyKnowledgeBase} onToast={onToast} />
      </AppPreferencesProvider>
    );

    await waitFor(() => expect(screen.getAllByText('Cliente Remarcado').length).toBeGreaterThan(0));

    const resyncButton = await screen.findByTitle(
      'Ressincronizar com o horário atual da agenda — use se a cliente remarcou por fora (ex.: direto no Google Calendar) e este card ficou desatualizado.'
    );

    await act(async () => {
      fireEvent.click(resyncButton);
    });

    await waitFor(() => expect(resyncMock).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(onToast).toHaveBeenCalledWith('Agendamento ressincronizado com o horário atual da agenda.'));
  });

  it('não mostra o botão quando o contato não tem nenhum agendamento vinculado', async () => {
    appointmentState = null as any;
    render(
      <AppPreferencesProvider>
        <WhatsAppLeadsSim onSaveTranscript={vi.fn()} activeTenant={INITIAL_TENANTS[0]} knowledgeBase={emptyKnowledgeBase} />
      </AppPreferencesProvider>
    );

    await waitFor(() => expect(screen.getAllByText('Cliente Remarcado').length).toBeGreaterThan(0));
    await waitFor(() => expect(screen.getByText('Nenhum agendamento ativo')).not.toBeNull());
    expect(screen.queryByTitle(/Ressincronizar com o horário atual da agenda/)).toBeNull();
  });
});
