// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { OperatorCRM } from '../OperatorCRM';
import type { LeadInfo } from '../../types';
vi.mock('../../contexts/AppPreferencesContext', () => ({ useAppPreferences: () => ({ language: 'pt' }) }));
afterEach(() => cleanup());
const lead: LeadInfo = {
  id: 'real-595981111111', name: 'Cliente', phone: '595981111111', timestamp: '2026-11-19T12:00:00Z',
  audioDuration: 0, status: 'transcribed', isReal: true, hasConversation: true, crmStage: 'contato', crmTasks: [],
};
function openTaskForm(onUpdateLead: any) {
  render(<OperatorCRM leads={[lead]} currentUser={{ name: 'Ana' }} onUpdateLead={onUpdateLead} />);
  fireEvent.click(screen.getByRole('button', { name: 'Responder' }));
}
describe('CRM com dados reais', () => {
  it('não inventa 50% quando não há análise', () => {
    render(<OperatorCRM leads={[lead]} mobileSection="board" onUpdateLead={vi.fn()} />);
    expect(screen.getByText('Prob.:').parentElement?.textContent).toContain('Sem análise');
    expect(screen.queryByText('50%')).toBeNull();
  });
  it('preserva probabilidade real de 0%', () => {
    render(<OperatorCRM leads={[{ ...lead, fullAnalysis: { dealProbability: 0 } as any }]} mobileSection="board" onUpdateLead={vi.fn()} />);
    expect(screen.getByText('Prob.:').parentElement?.textContent).toContain('0%');
    expect(screen.getByText('Prob.:').parentElement?.textContent).not.toContain('Sem análise');
  });
  it('salva exatamente a data e hora escolhidas e o responsável', async () => {
    const save = vi.fn(async (_updated: LeadInfo) => true);
    openTaskForm(save);
    fireEvent.change(screen.getByLabelText('Título da tarefa'), { target: { value: 'Retomar orçamento' } });
    fireEvent.change(screen.getByLabelText('Data e hora do retorno'), { target: { value: '2026-11-24T15:30' } });
    fireEvent.click(screen.getByRole('button', { name: 'Adicionar' }));
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    expect(save.mock.calls[0][0].crmTasks[0]).toMatchObject({ title: 'Retomar orçamento', dueDate: new Date('2026-11-24T15:30').toISOString(), assignedOperator: 'Ana' });
    await waitFor(() => expect((screen.getByLabelText('Título da tarefa') as HTMLInputElement).value).toBe(''));
  });
  it('não cria uma tarefa com prazo fictício quando a data está ausente', () => {
    const save = vi.fn();openTaskForm(save);
    fireEvent.change(screen.getByLabelText('Título da tarefa'), { target: { value: 'Retomar' } });
    fireEvent.submit(screen.getByLabelText('Título da tarefa').closest('form')!);
    expect(save).not.toHaveBeenCalled();
    expect(screen.getByRole('alert').textContent).toContain('Escolha uma data e hora válidas');
  });
  it('mantém o rascunho quando o servidor não confirma a gravação', async () => {
    openTaskForm(vi.fn(async () => false));
    fireEvent.change(screen.getByLabelText('Título da tarefa'), { target: { value: 'Não perder este retorno' } });
    fireEvent.change(screen.getByLabelText('Data e hora do retorno'), { target: { value: '2026-11-24T10:00' } });
    fireEvent.click(screen.getByRole('button', { name: 'Adicionar' }));
    await screen.findByRole('alert');
    expect((screen.getByLabelText('Título da tarefa') as HTMLInputElement).value).toBe('Não perder este retorno');
  });
  it('o atalho financeiro só encaminha ao módulo; não altera o lead', () => {
    const save = vi.fn(), navigate = vi.fn();
    render(<OperatorCRM leads={[lead]} currentUser={{ name: 'Ana' }} onUpdateLead={save} onNavigateToFinancial={navigate} />);
    fireEvent.click(screen.getByRole('button', { name: 'Responder' }));
    fireEvent.click(screen.getByRole('button', { name: 'Abrir Financeiro' }));
    expect(navigate).toHaveBeenCalledWith(lead);
    expect(save).not.toHaveBeenCalled();
  });
  it('novo lead começa sem valor fictício', () => {
    const save = vi.fn();
    render(<OperatorCRM leads={[]} onUpdateLead={save} />);
    fireEvent.click(screen.getByRole('button', { name: 'Novo lead' }));
    expect((screen.getByRole('spinbutton') as HTMLInputElement).value).toBe('');
    fireEvent.change(screen.getByPlaceholderText('Ex.: Maria Silva'), { target: { value: 'Novo contato' } });
    fireEvent.change(screen.getByPlaceholderText('+55 (11) 98765-4321'), { target: { value: '595981111111' } });
    fireEvent.submit(screen.getByPlaceholderText('Ex.: Maria Silva').closest('form')!);
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ name: 'Novo contato', dealValue: undefined }));
  });

});
