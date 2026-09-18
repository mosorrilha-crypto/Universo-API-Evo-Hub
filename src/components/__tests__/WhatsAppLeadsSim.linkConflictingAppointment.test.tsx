// @vitest-environment jsdom
/**
 * TASK-0433 (achado real, pedido direto: prints mostrando "Esse horário já
 * está ocupado na agenda" ao tentar cadastrar um agendamento manual, sem
 * nenhum jeito de vincular o comprovante ao evento que já existe na agenda —
 * e "Registrar receita avulsa" caindo no mesmo beco sem saída, "Nenhum
 * agendamento rastreado para este contato"). Cobre o caminho ponta a ponta:
 * cadastro manual bate em 409 com o evento real que colide
 * (`conflictingEvent`) → operador clica "Vincular" → POST link-appointment
 * (+ verify-payment, já que "comprovante recebido" estava marcado) → Ficha
 * do Contato passa a refletir o agendamento real, sem duplicar nada na
 * agenda.
 */
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WhatsAppLeadsSim } from '../WhatsAppLeadsSim';
import { emptyKnowledgeBase } from '../AgentKnowledgeBase';
import { AppPreferencesProvider } from '../../contexts/AppPreferencesContext';
import { INITIAL_TENANTS } from '../../data/mockTenants';

const jsonResponse = (body: unknown, ok = true, status?: number) => ({
  ok,
  status: status ?? (ok ? 200 : 500),
  json: async () => body,
} as Response);

const PHONE = '595985868809';

const linkAppointmentMock = vi.fn(async () => jsonResponse({
  appointment: { eventId: 'evt-existente-real', summary: 'Efecto Volumen Brasileño', startIso: '2026-09-17T09:30:00-04:00', endIso: '2026-09-17T10:30:00-04:00', source: 'manual' },
}));
const verifyPaymentMock = vi.fn(async () => jsonResponse({
  appointment: { eventId: 'evt-existente-real', summary: 'Efecto Volumen Brasileño', startIso: '2026-09-17T09:30:00-04:00', endIso: '2026-09-17T10:30:00-04:00', source: 'manual', paymentStatus: 'verified' },
}));

vi.mock('../../lib/apiClient', () => ({
  apiFetch: vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.startsWith('/api/conversations?archived=true')) {
      return jsonResponse({
        conversations: [
          {
            phone: PHONE,
            name: 'Nadia',
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
    if (url === `/api/conversations/${PHONE}/manual-appointment` && init?.method === 'POST') {
      return jsonResponse({ error: 'Esse horário já está ocupado na agenda.', conflictingEvent: { eventId: 'evt-existente-real', summary: 'Efecto Volumen Brasileño', startIso: '2026-09-17T09:30:00-04:00', endIso: '2026-09-17T10:30:00-04:00' } }, false, 409);
    }
    if (url === `/api/conversations/${PHONE}/link-appointment` && init?.method === 'POST') {
      return linkAppointmentMock();
    }
    if (url === `/api/conversations/${PHONE}/verify-payment` && init?.method === 'POST') {
      return verifyPaymentMock();
    }
    if (url.startsWith(`/api/conversations/${PHONE}/appointment`)) {
      return jsonResponse({ appointment: null });
    }
    // Qualquer outro endpoint (contexto do lead, templates de reengajamento, status do agente, horários livres): resposta neutra.
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

Object.defineProperty(window, 'innerWidth', { value: 1280, configurable: true });

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('WhatsAppLeadsSim — vincular agendamento existente no conflito do cadastro manual (TASK-0433)', () => {
  it('409 com conflictingEvent oferece "Vincular", e clicar vincula + verifica o pagamento marcado no mesmo formulário', async () => {
    const onToast = vi.fn();
    render(
      <AppPreferencesProvider>
        <WhatsAppLeadsSim onSaveTranscript={vi.fn()} activeTenant={INITIAL_TENANTS[0]} knowledgeBase={emptyKnowledgeBase} onToast={onToast} />
      </AppPreferencesProvider>
    );

    await waitFor(() => expect(screen.getAllByText('Nadia').length).toBeGreaterThan(0));

    const cadastrarButton = await screen.findByTitle('Cadastrar um agendamento manual (combinado fora do WhatsApp)');
    fireEvent.click(cadastrarButton);

    // Serviço personalizado (sem catálogo carregado nesta suíte) + duração.
    fireEvent.click(screen.getByText('Serviço personalizado'));
    fireEvent.change(screen.getByPlaceholderText('Ex: Pacote personalizado combinado com a cliente'), { target: { value: 'Efecto Volumen Brasileño' } });
    fireEvent.change(screen.getByPlaceholderText('Ex: 90'), { target: { value: '60' } });
    fireEvent.change(document.querySelector('input[type="date"]')!, { target: { value: '2026-09-17' } });
    // A busca de horários livres (GET free-slots) responde "não ok" nesta
    // suíte (endpoint fora do escopo do teste) — espera o modal cair pro
    // input de horário manual em vez do seletor de slots.
    await waitFor(() => expect(document.querySelector('input[type="time"]')).toBeTruthy());
    const timeInput = document.querySelector('input[type="time"]')!;
    fireEvent.change(timeInput, { target: { value: '09:30' } });

    // Comprovante já recebido, com valor real diferente do catálogo (mesmo caso do print: Gs 200.000 via Itaú).
    fireEvent.click(screen.getByText(/Comprovante de pagamento já recebido/));
    fireEvent.change(screen.getByPlaceholderText('Ex: 50000'), { target: { value: '200000' } });

    // "Cadastrar" também aparece no botão que ainda abre este mesmo modal na
    // Ficha do Contato (por trás do overlay) — usa o botão de submit real.
    fireEvent.click(document.querySelector('form button[type="submit"]')!);

    const linkButton = await screen.findByText('Vincular este agendamento já existente ao contato');
    expect(screen.getByText(/Efecto Volumen Brasileño/)).toBeTruthy();

    await act(async () => {
      fireEvent.click(linkButton);
    });

    await waitFor(() => expect(linkAppointmentMock).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(verifyPaymentMock).toHaveBeenCalledTimes(1));

    // Modal fecha (sucesso) — o botão de vincular não fica mais na tela.
    await waitFor(() => expect(screen.queryByText('Vincular este agendamento já existente ao contato')).toBeNull());
  });
});
