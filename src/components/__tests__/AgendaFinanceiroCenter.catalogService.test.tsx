// @vitest-environment jsdom
/**
 * TASK-0351 (pedido direto): "serviços poderia estar conectado ao catálogo
 * para pichar [puxar] o valor e tempo de duração e para futuramente criar
 * relatórios". "Novo agendamento" ganhou um seletor opcional do catálogo de
 * serviços (`knowledgeBase.products`, já carregado em App.tsx — nenhuma
 * chamada de API nova); escolher um item preenche Serviço/Valor e usa a
 * duração real do serviço (`durationMinutes`) em vez da 1h fixa de sempre.
 */
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AgendaFinanceiroCenter } from '../AgendaFinanceiroCenter';
import type { AgentProduct, FinancialTransaction, LeadInfo, UserProfile } from '../../types';

vi.mock('../../contexts/AppPreferencesContext', () => ({
  useAppPreferences: () => ({ language: 'pt' }),
}));

const api = vi.hoisted(() => ({ apiFetch: vi.fn() }));
vi.mock('../../lib/apiClient', () => api);

afterEach(() => cleanup());

const currentUser: UserProfile = { id: 'operator-a', tenantId: 'tenant-a', name: 'Operador', email: 'operador@empresa.test', role: 'manager', avatar: '', department: '' };
const transactions: FinancialTransaction[] = [];
const leads: LeadInfo[] = [{ id: 'lead-1', name: 'Ana Paula', phone: '595981123456' } as LeadInfo];

const catalogProducts: AgentProduct[] = [
  { id: 'prod-1', name: 'Design de sobrancelhas', price: 'PYG 150.000', description: '', priceAmount: 150000, durationMinutes: 45 },
  { id: 'prod-2', name: 'Retoque (não agendável)', price: 'PYG 30.000', description: '', priceAmount: 30000, bookable: false },
  { id: 'prod-3', name: 'Serviço pausado', price: 'PYG 10.000', description: '', priceAmount: 10000, active: false },
];

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
    catalogProducts,
  };
}

beforeEach(() => {
  api.apiFetch.mockReset();
  api.apiFetch.mockImplementation(async (url: string) => {
    if (typeof url === 'string' && url.includes('/api/google-calendar/upcoming-events')) {
      return { ok: true, json: async () => ({ events: [] }) } as Response;
    }
    return { ok: true, json: async () => ({}) } as Response;
  });
});

describe('AgendaFinanceiroCenter — "Novo agendamento" conectado ao catálogo', () => {
  it('escolher um serviço do catálogo preenche Serviço e Valor automaticamente', async () => {
    render(<AgendaFinanceiroCenter {...baseProps()} />);
    await waitFor(() => expect(api.apiFetch).toHaveBeenCalled());

    fireEvent.click(screen.getByRole('button', { name: /Novo agendamento/ }));
    expect(screen.getByRole('heading', { name: 'Novo agendamento' })).not.toBeNull();

    fireEvent.change(screen.getByRole('combobox', { name: 'Serviço do catálogo (opcional)' }), { target: { value: 'prod-1' } });

    expect(screen.getByDisplayValue('Design de sobrancelhas')).not.toBeNull();
    expect(screen.getByDisplayValue('150000')).not.toBeNull();
  });

  it('só lista serviços agendáveis e ativos do catálogo (não agendável/pausado ficam de fora)', async () => {
    render(<AgendaFinanceiroCenter {...baseProps()} />);
    await waitFor(() => expect(api.apiFetch).toHaveBeenCalled());

    fireEvent.click(screen.getByRole('button', { name: /Novo agendamento/ }));

    const select = screen.getByRole('combobox', { name: 'Serviço do catálogo (opcional)' });
    expect(screen.getByText('Design de sobrancelhas — 150000', { selector: 'option' })).not.toBeNull();
    expect(select.querySelector('option[value="prod-2"]')).toBeNull();
    expect(select.querySelector('option[value="prod-3"]')).toBeNull();
  });

  it('sem catálogo (tenant sem produtos), o campo Serviço continua livre, sem seletor', async () => {
    render(<AgendaFinanceiroCenter {...baseProps()} catalogProducts={[]} />);
    await waitFor(() => expect(api.apiFetch).toHaveBeenCalled());

    fireEvent.click(screen.getByRole('button', { name: /Novo agendamento/ }));
    expect(screen.queryByText('Serviço do catálogo (opcional)')).toBeNull();
  });

  it('cria o agendamento usando a duração real do serviço escolhido, não a 1h fixa padrão', async () => {
    render(<AgendaFinanceiroCenter {...baseProps()} />);
    await waitFor(() => expect(api.apiFetch).toHaveBeenCalled());

    fireEvent.click(screen.getByRole('button', { name: /Novo agendamento/ }));
    fireEvent.change(screen.getByRole('combobox', { name: 'Serviço do catálogo (opcional)' }), { target: { value: 'prod-1' } });
    fireEvent.change(screen.getByPlaceholderText('Ej.: 595 981 123456'), { target: { value: '595981123456' } });
    fireEvent.change(screen.getByLabelText('Data'), { target: { value: '2026-09-10' } });
    fireEvent.change(screen.getByLabelText('Hora'), { target: { value: '10:00' } });

    fireEvent.click(screen.getByRole('button', { name: /Criar agendamento e cobrança/ }));

    await waitFor(() => expect(api.apiFetch).toHaveBeenCalledWith(
      expect.stringContaining('/manual-appointment'),
      expect.objectContaining({ body: expect.stringContaining('"endIso":"2026-09-10T10:45:00"') })
    ));
  });
});
