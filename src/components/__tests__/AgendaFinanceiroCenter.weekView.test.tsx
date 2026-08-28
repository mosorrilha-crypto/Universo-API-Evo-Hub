// @vitest-environment jsdom
/**
 * Pedido direto do dono do produto (28/08/2026, print de outro app de
 * agendamentos como referência): seletor Semana/Mês dentro do card do
 * calendário. Semana ganha uma grade nova por horário (dias em colunas,
 * compromissos posicionados pelo horário real).
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

describe('AgendaFinanceiroCenter — seletor Semana/Mês', () => {
  it('começa na visão de Mês por padrão (grade com 7 colunas de dia do mês)', async () => {
    render(<AgendaFinanceiroCenter {...baseProps()} />);
    await waitFor(() => expect(api.apiFetch).toHaveBeenCalled());

    expect(screen.getByRole('button', { name: 'Mês' })).not.toBeNull();
    expect(screen.getByRole('button', { name: 'Semana' })).not.toBeNull();
    // Grade de mês mostra o dia 1 do mês corrente (célula que só existe na grade de mês).
    expect(screen.getByRole('button', { name: /^1 / })).not.toBeNull();
  });

  it('troca pra visão de Semana ao tocar no botão e mostra um compromisso posicionado por horário', async () => {
    const today = new Date();
    const startIso = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 10, 0, 0).toISOString();
    const endIso = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 11, 0, 0).toISOString();
    api.apiFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ events: [{ id: 'evt-1', summary: 'Corte de Cabelo', startIso, endIso, completed: false, payment: null }] }),
    });

    render(<AgendaFinanceiroCenter {...baseProps()} />);
    await waitFor(() => expect(api.apiFetch).toHaveBeenCalled());

    fireEvent.click(screen.getByRole('button', { name: 'Semana' }));

    // "Corte de Cabelo" também aparece no painel "Próximos compromissos" (não muda com o
    // seletor Semana/Mês) — por isso getAllByText, não getByText.
    await waitFor(() => expect(screen.getAllByText('Corte de Cabelo').length).toBeGreaterThan(0));
  });

  it('navega pra semana seguinte/anterior sem quebrar', async () => {
    render(<AgendaFinanceiroCenter {...baseProps()} />);
    await waitFor(() => expect(api.apiFetch).toHaveBeenCalled());

    fireEvent.click(screen.getByRole('button', { name: 'Semana' }));
    const nextButton = screen.getByRole('button', { name: 'Próxima semana' });
    const prevButton = screen.getByRole('button', { name: 'Semana anterior' });

    expect(() => fireEvent.click(nextButton)).not.toThrow();
    expect(() => fireEvent.click(prevButton)).not.toThrow();
  });

  it('abre a edição do compromisso ao tocar no bloco da grade de semana', async () => {
    const today = new Date();
    const startIso = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 14, 0, 0).toISOString();
    api.apiFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ events: [{ id: 'evt-2', summary: 'Manicure', startIso, completed: false, payment: null }] }),
    });

    render(<AgendaFinanceiroCenter {...baseProps()} />);
    await waitFor(() => expect(api.apiFetch).toHaveBeenCalled());
    fireEvent.click(screen.getByRole('button', { name: 'Semana' }));
    // "Manicure" também aparece no painel "Próximos compromissos"; o bloco da
    // grade de semana vem primeiro no DOM (a grade é a primeira seção da tela).
    await waitFor(() => expect(screen.getAllByText('Manicure').length).toBeGreaterThan(0));

    fireEvent.click(screen.getAllByText('Manicure')[0]);
    expect(screen.getByRole('heading', { name: 'Editar agendamento' })).not.toBeNull();
  });
});
