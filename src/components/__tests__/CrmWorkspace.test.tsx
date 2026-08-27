// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CrmWorkspace } from '../CrmWorkspace';

vi.mock('../OperatorCRM', () => ({
  OperatorCRM: ({ mobileSection }: { mobileSection: string }) => <p>Contexto CRM: {mobileSection}</p>,
}));

vi.mock('../../contexts/AppPreferencesContext', () => ({
  useAppPreferences: () => ({ language: 'pt' }),
}));

const props = {
  leads: [],
  currentUser: { id: 'operator-a', tenantId: 'tenant-a', name: 'Operador', email: 'operador@empresa.test', role: 'manager' as const, avatar: '', department: '' },
  onUpdateLead: vi.fn(),
  onDeleteLead: vi.fn(),
  onClearAllLeads: vi.fn(),
};

afterEach(() => cleanup());

describe('CrmWorkspace — navegação móvel', () => {
  it('prioriza leads ao abrir o CRM', () => {
    render(<CrmWorkspace {...props} />);

    expect(screen.getByText('Contexto CRM: leads')).not.toBeNull();
    expect(screen.getByRole('button', { name: 'Leads' }).getAttribute('aria-pressed')).toBe('true');
  });

  it('exibe indicadores e quadro apenas quando selecionados', () => {
    render(<CrmWorkspace {...props} />);

    fireEvent.click(screen.getByRole('button', { name: 'Indicadores' }));
    expect(screen.getByText('Contexto CRM: insights')).not.toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Quadro' }));
    expect(screen.getByText('Contexto CRM: board')).not.toBeNull();
  });
});
