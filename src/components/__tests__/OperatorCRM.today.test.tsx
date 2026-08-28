// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { OperatorCRM } from '../OperatorCRM';
import type { FinancialTransaction, LeadInfo } from '../../types';

vi.mock('../../contexts/AppPreferencesContext', () => ({
  useAppPreferences: () => ({ language: 'pt' }),
}));

afterEach(() => cleanup());

const user = { id: 'operator-a', tenantId: 'tenant-a', name: 'Operador', email: 'operador@empresa.test', role: 'manager' as const, avatar: '', department: 'Vendas' };

const lead: LeadInfo = {
  id: 'real-5511999999999',
  tenantId: 'tenant-a',
  name: 'Cliente CRM',
  phone: '5511999999999',
  timestamp: new Date().toISOString(),
  audioDuration: 0,
  status: 'transcribed',
  isReal: true,
  hasConversation: true,
  crmStage: 'negociacao',
  crmTasks: [{ id: 'task-1', title: 'Retomar proposta', dueDate: 'Hoje 15:00', completed: false, assignedOperator: 'Operador' }],
};

const transaction: FinancialTransaction = {
  id: 'tx-1',
  tenantId: 'tenant-a',
  leadId: lead.id,
  leadName: lead.name,
  leadPhone: lead.phone,
  productName: 'Serviço',
  amount: 150000,
  paymentMethod: 'PIX',
  status: 'pendente',
  date: new Date().toISOString(),
  operatorName: 'Operador',
  channel: 'WhatsApp',
};

describe('OperatorCRM — fila Hoje', () => {
  it('mostra a próxima tarefa com origem, prazo e ação primária', () => {
    render(<OperatorCRM leads={[lead]} currentUser={user} transactions={[]} escalations={[]} onUpdateLead={vi.fn()} />);

    expect(screen.getByRole('heading', { name: 'CRM Hoje' })).not.toBeNull();
    expect(screen.getByText(/Tarefa · Retomar proposta · Hoje 15:00/)).not.toBeNull();
    expect(screen.getByRole('button', { name: 'Abrir tarefa' })).not.toBeNull();
  });

  it('prioriza cobrança pendente e encaminha ao financeiro', () => {
    const onNavigateToFinancial = vi.fn();
    render(<OperatorCRM leads={[lead]} currentUser={user} transactions={[transaction]} escalations={[]} onUpdateLead={vi.fn()} onNavigateToFinancial={onNavigateToFinancial} />);

    fireEvent.click(screen.getByRole('button', { name: 'Revisar cobrança' }));
    expect(onNavigateToFinancial).toHaveBeenCalledWith(lead);
  });

  it('deduplica múltiplas pendências do mesmo lead mantendo a ação mais urgente', () => {
    render(<OperatorCRM leads={[lead]} currentUser={user} transactions={[transaction]} escalations={[]} onUpdateLead={vi.fn()} onNavigateToFinancial={vi.fn()} />);

    expect(screen.getAllByRole('button', { name: 'Revisar cobrança' })).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Revisar cobrança' })).not.toBeNull();
    expect(screen.queryByRole('button', { name: 'Abrir tarefa' })).toBeNull();
  });

  it('mostra o estado de sincronização sem alterar a ação da fila', () => {
    render(<OperatorCRM leads={[lead]} currentUser={user} syncState="saving" onUpdateLead={vi.fn()} />);

    expect(screen.getByText('Salvando…')).not.toBeNull();
    expect(screen.getByRole('button', { name: 'Abrir tarefa' })).not.toBeNull();
  });

  it('alterna a seção interna sem perder a fila ou criar outra consulta', () => {
    render(<OperatorCRM leads={[lead]} currentUser={user} transactions={[]} escalations={[]} onUpdateLead={vi.fn()} />);

    const pipeline = screen.getByRole('button', { name: 'Pipeline' });
    expect(screen.getByRole('button', { name: 'Hoje' }).getAttribute('aria-current')).toBe('page');
    fireEvent.click(pipeline);
    expect(pipeline.getAttribute('aria-current')).toBe('page');
  });
});
