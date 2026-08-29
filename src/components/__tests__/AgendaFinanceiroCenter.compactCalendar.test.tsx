// @vitest-environment jsdom
/**
 * Pedidos diretos do dono do produto, com prints da tela (26/08 e 28/08/2026):
 * o topo da Agenda repetia a mesma informação em blocos empilhados (nav de
 * mês + banner "Dia selecionado"), ocupando espaço à toa e ainda quebrando em
 * 3 linhas num celular real; as células vazias antes do dia 1 do mês não
 * tinham altura definida, deixando a primeira linha da grade desalinhada; e
 * tocar em QUALQUER dia da grade sempre abria "Novo agendamento", mesmo num
 * dia que já tinha compromisso — o preview de horário dentro da célula não
 * levava a lugar nenhum de útil.
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

    const blanks = container.querySelectorAll('[aria-hidden="true"].min-h-11');
    expect(blanks.length).toBeGreaterThan(0);
  });
});

describe('AgendaFinanceiroCenter — toque no dia da grade (achado real: sempre abria "Novo agendamento")', () => {
  const today = new Date();
  const year = today.getFullYear();
  const month = today.getMonth();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const todayDate = today.getDate();

  function pickDayNot(...exclude: number[]) {
    for (let day = 1; day <= daysInMonth; day += 1) if (!exclude.includes(day)) return day;
    throw new Error('Mês de teste sem dias suficientes');
  }

  const emptyDay = pickDayNot(todayDate);
  const twoApptsDay = pickDayNot(todayDate, emptyDay);

  function isoAt(day: number, hour = 12) {
    return new Date(year, month, day, hour, 0, 0).toISOString();
  }

  const monthLabel = today.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
  const emptyDayLabel = `${emptyDay} ${monthLabel}`;
  const todayLabel = `Hoje, ${todayDate} ${monthLabel} · 1 compromissos`;
  const twoApptsLabel = `${twoApptsDay} ${monthLabel} · 2 compromissos`;

  const events = [
    { id: 'evt-today', summary: 'Corte de Cabelo', startIso: isoAt(todayDate), completed: false, payment: null },
    { id: 'evt-two-a', summary: 'Manicure', startIso: isoAt(twoApptsDay, 10), completed: false, payment: null },
    { id: 'evt-two-b', summary: 'Sobrancelha', startIso: isoAt(twoApptsDay, 14), completed: false, payment: null },
  ];

  beforeEach(() => {
    api.apiFetch.mockResolvedValue({ ok: true, json: async () => ({ events }) });
  });

  it('dia sem compromisso abre a criação de um novo agendamento', async () => {
    render(<AgendaFinanceiroCenter {...baseProps()} />);
    await waitFor(() => expect(api.apiFetch).toHaveBeenCalled());

    fireEvent.click(screen.getByRole('button', { name: emptyDayLabel }));
    expect(screen.getByRole('heading', { name: 'Novo agendamento' })).not.toBeNull();
  });

  it('dia com exatamente 1 compromisso abre a edição DELE, não a criação de um novo', async () => {
    render(<AgendaFinanceiroCenter {...baseProps()} />);
    await waitFor(() => expect(api.apiFetch).toHaveBeenCalled());

    fireEvent.click(screen.getByRole('button', { name: todayLabel }));
    expect(screen.getByRole('heading', { name: 'Editar agendamento' })).not.toBeNull();
    expect(screen.getByDisplayValue('Corte de Cabelo')).not.toBeNull();
  });

  it('dia com 2+ compromissos só seleciona (evita abrir o compromisso errado sem o operador escolher qual)', async () => {
    render(<AgendaFinanceiroCenter {...baseProps()} />);
    await waitFor(() => expect(api.apiFetch).toHaveBeenCalled());

    fireEvent.click(screen.getByRole('button', { name: twoApptsLabel }));
    expect(screen.queryByRole('heading', { name: 'Novo agendamento' })).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Editar agendamento' })).toBeNull();
  });
});
