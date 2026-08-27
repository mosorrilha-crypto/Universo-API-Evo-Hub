// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FinancialWorkspace } from '../FinancialWorkspace';

vi.mock('../AgendaFinanceiroCenter', () => ({
  AgendaFinanceiroCenter: () => <div>Resumo financeiro visível</div>,
}));

vi.mock('../FinancialOperationsCenter', () => ({
  FinancialOperationsCenter: ({ activeSection, onNavigateToSection }: { activeSection: string; onNavigateToSection?: (section: 'titles' | 'purchases' | 'inventory' | 'structure') => void }) => (
    <div>
      <p>Área operacional: {activeSection}</p>
      <button type="button" onClick={() => onNavigateToSection?.('purchases')}>Ir para compras</button>
    </div>
  ),
}));

const props = {
  transactions: [],
  leads: [],
  currentUser: { id: 'operator-a', tenantId: 'tenant-a', name: 'Operador', email: 'operador@empresa.test', role: 'manager' as const, avatar: '', department: '' },
  currency: 'BRL',
  locale: 'pt-BR',
  onAddTransaction: async () => true,
  onUpdateTransactionStatus: vi.fn(),
  onDeleteTransaction: vi.fn(),
  onToast: vi.fn(),
  recurringExpenses: [],
  onAddRecurringExpense: async () => true,
  onToggleRecurringExpense: vi.fn(),
  onDeleteRecurringExpense: vi.fn(),
};

afterEach(() => {
  cleanup();
});

describe('FinancialWorkspace — navegação por contexto', () => {
  it('abre no resumo e troca para títulos sem empilhar os dois painéis', () => {
    render(<FinancialWorkspace {...props} />);

    expect(screen.getByText('Resumo financeiro visível')).not.toBeNull();
    expect(screen.getByText('Área operacional: titles').closest('[hidden]')).not.toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /títulos/i }));

    expect(screen.getByText('Resumo financeiro visível').closest('[hidden]')).not.toBeNull();
    expect(screen.getByText('Área operacional: titles')).not.toBeNull();
    expect(screen.getByRole('button', { name: /títulos/i }).getAttribute('aria-pressed')).toBe('true');
  });

  it('permite que um atalho contextual leve diretamente para compras', () => {
    render(<FinancialWorkspace {...props} />);

    fireEvent.click(screen.getByRole('button', { name: /títulos/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Ir para compras' }));

    expect(screen.getByText('Área operacional: purchases')).not.toBeNull();
    const purchasesNavigation = screen.getAllByRole('button', { name: /compras/i }).find((button) => button.hasAttribute('aria-pressed'));
    expect(purchasesNavigation?.getAttribute('aria-pressed')).toBe('true');
  });
});
