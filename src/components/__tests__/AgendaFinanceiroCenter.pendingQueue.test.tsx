// @vitest-environment jsdom
/**
 * Achado da auditoria da PR #494 (28/08/2026): o botão "Pendências" da
 * navegação móvel da Agenda já existia em produção, mas não renderizava
 * nada de útil — a fila de pendências (`pendingAppointments`) nunca tinha
 * sido conectada a uma seção real. Além disso, o mapa de processos da
 * Agenda definiu que um evento CONCLUÍDO com cobrança ainda em aberto deve
 * voltar pra fila pra revisão pós-atendimento, mas a primeira versão da
 * fila excluía qualquer evento concluído. Este teste cobre as duas coisas:
 * a seção "Pendências da agenda" aparece de verdade, e um atendimento já
 * concluído com pagamento pendente aparece nela quando o Financeiro está
 * habilitado.
 *
 * Atualizado em 28/08/2026 (pedido do dono do produto com print): a aba
 * "Pendências" separada foi removida por redundância — a mesma seção
 * agora vive dentro da aba "Hoje" (`mobileAgendaView: 'today'`).
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
    mobileAgendaView: 'today' as const,
  };
}

const FUTURE = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString();
const PAST = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();

beforeEach(() => {
  api.apiFetch.mockReset();
});

describe('AgendaFinanceiroCenter — fila de Pendências', () => {
  it('mostra compromisso futuro sem cobrança confirmada', async () => {
    api.apiFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        events: [
          { id: 'evt-1', summary: 'Corte de cabelo', startIso: FUTURE, completed: false, payment: { amount: 100, paymentMethod: 'PIX', status: 'pendente' } },
        ],
      }),
    });

    render(<AgendaFinanceiroCenter {...baseProps()} />);

    await waitFor(() => expect(screen.getAllByText('Corte de cabelo').length).toBeGreaterThan(0));
  });

  it('traz de volta um atendimento já concluído com cobrança em aberto (revisão pós-atendimento)', async () => {
    api.apiFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        events: [
          { id: 'evt-done-open', summary: 'Manicure', startIso: PAST, completed: true, payment: { amount: 50, paymentMethod: 'PIX', status: 'pendente' } },
          { id: 'evt-done-paid', summary: 'Sobrancelha', startIso: PAST, completed: true, payment: { amount: 30, paymentMethod: 'PIX', status: 'pago' } },
        ],
      }),
    });

    render(<AgendaFinanceiroCenter {...baseProps()} />);

    await waitFor(() => expect(screen.getByText('Manicure')).not.toBeNull());
    expect(screen.queryByText('Sobrancelha')).toBeNull();
  });

  it('sem Financeiro habilitado, evento concluído não retorna à fila mesmo sem registro de cobrança', async () => {
    api.apiFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        events: [
          { id: 'evt-done-no-financial', summary: 'Depilação', startIso: PAST, completed: true, payment: null },
        ],
      }),
    });

    render(<AgendaFinanceiroCenter {...baseProps()} financialModuleEnabled={false} />);

    await waitFor(() => expect(api.apiFetch).toHaveBeenCalled());
    expect(screen.queryByText('Depilação')).toBeNull();
    expect(screen.getByText('Nenhuma pendência para revisar.')).not.toBeNull();
  });
});
