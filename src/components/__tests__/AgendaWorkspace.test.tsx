// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AgendaWorkspace } from '../AgendaWorkspace';

vi.mock('../AgendaFinanceiroCenter', () => ({
  AgendaFinanceiroCenter: ({ mobileAgendaView }: { mobileAgendaView: string }) => <p>Visão ativa: {mobileAgendaView}</p>,
}));

const props = {
  transactions: [],
  leads: [],
  currentUser: { id: 'operator-a', tenantId: 'tenant-a', name: 'Operador', email: 'operador@empresa.test', role: 'manager' as const, avatar: '', department: '' },
  onAddTransaction: async () => true,
  onUpdateTransactionStatus: vi.fn(),
  onDeleteTransaction: vi.fn(),
  onToast: vi.fn(),
};

afterEach(() => cleanup());

describe('AgendaWorkspace — navegação móvel', () => {
  it('prioriza a rotina de hoje ao abrir a agenda', () => {
    render(<AgendaWorkspace {...props} />);

    expect(screen.getByText('Visão ativa: today')).not.toBeNull();
    expect(screen.getByRole('button', { name: 'Hoje' }).getAttribute('aria-current')).toBe('page');
  });

  it('abre a semana apenas quando o operador solicita', () => {
    render(<AgendaWorkspace {...props} />);

    fireEvent.click(screen.getByRole('button', { name: 'Semana' }));

    expect(screen.getByText('Visão ativa: week')).not.toBeNull();
    expect(screen.getByRole('button', { name: 'Semana' }).getAttribute('aria-current')).toBe('page');
  });

  it('abre o calendário mensal apenas quando o operador solicita', () => {
    render(<AgendaWorkspace {...props} />);

    fireEvent.click(screen.getByRole('button', { name: 'Mês' }));

    expect(screen.getByText('Visão ativa: month')).not.toBeNull();
    expect(screen.getByRole('button', { name: 'Mês' }).getAttribute('aria-current')).toBe('page');
  });
});
