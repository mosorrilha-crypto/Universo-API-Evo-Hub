// @vitest-environment jsdom
/**
 * TASK-0292 (pedido direto, print real: "os agendamentos de agosto só
 * aparece no calendário como um número mas eu não consigo ver os dados
 * dele") — achado real: na visão de Mês, um dia com 2+ compromissos só
 * destacava a célula ao clicar (nada mais lia `selectedDate` pra mostrar os
 * dados de nenhum compromisso daquele dia). Cobre a lista compacta que
 * corrige isso.
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
  };
}

beforeEach(() => {
  api.apiFetch.mockReset();
});

describe('AgendaFinanceiroCenter — dia com 2+ compromissos na visão de Mês', () => {
  it('mostra a lista de compromissos do dia selecionado (hoje, já selecionado por padrão) e abre a edição ao clicar', async () => {
    const today = new Date();
    const startA = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 9, 0, 0).toISOString();
    const startB = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 15, 0, 0).toISOString();
    api.apiFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        events: [
          { id: 'evt-manha', summary: 'Sobrancelha', startIso: startA, completed: false, payment: null },
          { id: 'evt-tarde', summary: 'Cílios', startIso: startB, completed: false, payment: null },
        ],
      }),
    });

    render(<AgendaFinanceiroCenter {...baseProps()} />);
    await waitFor(() => expect(api.apiFetch).toHaveBeenCalled());

    // Hoje já é o dia selecionado por padrão — a lista aparece sem precisar clicar.
    await waitFor(() => {
      expect(screen.getAllByText(/Sobrancelha/).length).toBeGreaterThan(0);
      expect(screen.getAllByText(/Cílios/).length).toBeGreaterThan(0);
    });

    fireEvent.click(screen.getAllByText(/Sobrancelha/)[0]);
    expect(screen.getByRole('heading', { name: 'Editar agendamento' })).not.toBeNull();
  });

  it('dia com 0 ou 1 compromisso continua funcionando como antes (sem a lista extra)', async () => {
    const today = new Date();
    const startIso = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 10, 0, 0).toISOString();
    api.apiFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ events: [{ id: 'evt-unico', summary: 'Design de Sobrancelha', startIso, completed: false, payment: null }] }),
    });

    render(<AgendaFinanceiroCenter {...baseProps()} />);
    await waitFor(() => expect(api.apiFetch).toHaveBeenCalled());

    // Hoje (selecionado por padrão) tem só 1 compromisso — clicar na célula
    // já abre a edição direto (comportamento existente, não deve mudar).
    const todayCell = screen.getByRole('button', { name: new RegExp(`, ${today.getDate()} `) });
    fireEvent.click(todayCell);
    expect(screen.getByRole('heading', { name: 'Editar agendamento' })).not.toBeNull();
  });
});
