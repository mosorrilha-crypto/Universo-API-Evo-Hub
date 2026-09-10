// @vitest-environment jsdom
/**
 * Achado real (print anotado, Agenda "Hoje" no mobile): o botão de editar/
 * reagendar um compromisso já existia (`setAppointmentDialog({ mode:
 * 'edit', ... })`, abre o mesmo `AppointmentDialog`), mas só aparecia no
 * card COMPLETO (`!compact`), escondido atrás de hover — que nem existe em
 * touch. A lista "Hoje"/Pendências (usada no print) sempre renderiza
 * `EventCard` com `compact`, então não tinha nenhum jeito de abrir o popup
 * de edição/reagendamento a partir dali. Este teste cobre o botão novo no
 * card compacto abrindo o diálogo de edição.
 */
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AgendaFinanceiroCenter } from '../AgendaFinanceiroCenter';
import type { FinancialTransaction, LeadInfo, UserProfile } from '../../types';

vi.mock('../../contexts/AppPreferencesContext', () => ({
  useAppPreferences: () => ({ language: 'pt' }),
}));

const api = vi.hoisted(() => ({ apiFetch: vi.fn() }));
vi.mock('../../lib/apiClient', () => api);

afterEach(() => cleanup());

const currentUser: UserProfile = { id: 'operator-a', tenantId: 'tenant-a', name: 'Operador', email: 'operador@empresa.test', role: 'manager', avatar: '', department: '' };
const transactions: FinancialTransaction[] = [];
const leads: LeadInfo[] = [];

function baseProps() {
  return {
    scope: 'agenda' as const,
    transactions,
    leads,
    currentUser,
    onAddTransaction: vi.fn(async () => true),
    onUpdateTransactionStatus: vi.fn(),
    onDeleteTransaction: vi.fn(),
    onToast: vi.fn(),
    financialModuleEnabled: true,
    mobileAgendaView: 'today' as const,
  };
}

const FUTURE = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString();

beforeEach(() => {
  api.apiFetch.mockReset();
});

describe('AgendaFinanceiroCenter — botão de editar/reagendar no card compacto', () => {
  it('abre o diálogo de edição ao clicar no botão do card compacto (lista "Hoje")', async () => {
    api.apiFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        events: [
          { id: 'evt-1', summary: 'Gisela Mariel retoque', startIso: FUTURE, completed: false, payment: null },
        ],
      }),
    });

    render(<AgendaFinanceiroCenter {...baseProps()} />);

    await waitFor(() => expect(screen.getAllByText(/Gisela Mariel retoque/).length).toBeGreaterThan(0));

    const editButtons = screen.getAllByTitle('Editar/reagendar');
    expect(editButtons.length).toBeGreaterThan(0);
    fireEvent.click(editButtons[0]);

    await waitFor(() => expect(screen.getByText('Editar agendamento')).not.toBeNull());
  });
});
