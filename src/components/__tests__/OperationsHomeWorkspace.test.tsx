// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { OperationsHomeWorkspace } from '../OperationsHomeWorkspace';

vi.mock('../OperationsCenter', () => ({
  OperationsCenter: ({ mobileSection }: { mobileSection: string }) => <p>Contexto inicial: {mobileSection}</p>,
}));

vi.mock('../../contexts/AppPreferencesContext', () => ({
  useAppPreferences: () => ({ language: 'pt' }),
}));

const props = {
  activeTenant: { id: 'tenant-a', name: 'Empresa', currency: 'BRL', locale: 'pt-BR' },
  currentUser: null,
  leads: [],
  transactions: [],
  escalations: [],
  knowledgeBase: {},
  businessHours: {},
  canSeeAgenda: true,
  canSeeFinancial: true,
  canSeeAdminTools: true,
  onNavigate: vi.fn(),
} as any;

afterEach(() => cleanup());

describe('OperationsHomeWorkspace — navegação móvel', () => {
  it('prioriza pendências ao abrir a tela inicial', () => {
    render(<OperationsHomeWorkspace {...props} />);

    expect(screen.getByText('Contexto inicial: priorities')).not.toBeNull();
    expect(screen.getByRole('button', { name: 'Prioridades' }).getAttribute('aria-pressed')).toBe('true');
  });

  it('mantém atalhos e configuração como contextos escolhidos pelo operador', () => {
    render(<OperationsHomeWorkspace {...props} />);

    fireEvent.click(screen.getByRole('button', { name: 'Atalhos' }));
    expect(screen.getByText('Contexto inicial: shortcuts')).not.toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Configurar' }));
    expect(screen.getByText('Contexto inicial: setup')).not.toBeNull();
  });
});
