// @vitest-environment jsdom
/**
 * Pedido direto do dono do produto, com print da tela: o topo da Agenda
 * (nav de mês + banner "Dia selecionado") repetia a mesma informação
 * (selectedDateLabel) duas vezes em dois blocos empilhados, ocupando espaço
 * vertical à toa antes da grade do calendário aparecer no celular. E as
 * células vazias antes do dia 1 do mês (quando o mês não começa numa
 * segunda-feira) não tinham altura definida, deixando a primeira linha da
 * grade com aparência desalinhada/quebrada.
 */
import React from 'react';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
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
  api.apiFetch.mockResolvedValue({ ok: true, json: async () => ({ events: [] }) });
});

describe('AgendaFinanceiroCenter — topo compacto e grade organizada', () => {
  it('mostra o dia selecionado uma única vez, junto do nav de mês (sem banner duplicado)', async () => {
    render(<AgendaFinanceiroCenter {...baseProps()} />);
    await waitFor(() => expect(api.apiFetch).toHaveBeenCalled());

    expect(screen.getAllByRole('button', { name: /Ir para hoje/ })).toHaveLength(1);
    expect(screen.queryByText(/^Dia selecionado$/i)).toBeNull();
  });

  it('preenche os espaços vazios do início do mês com a mesma altura dos dias, mantendo a grade retangular', async () => {
    const { container } = render(<AgendaFinanceiroCenter {...baseProps()} />);
    await waitFor(() => expect(api.apiFetch).toHaveBeenCalled());

    const blanks = container.querySelectorAll('[aria-hidden="true"].min-h-14');
    expect(blanks.length).toBeGreaterThan(0);
  });
});
