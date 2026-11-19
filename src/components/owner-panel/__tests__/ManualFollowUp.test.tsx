// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ManualFollowUp } from '../ManualFollowUp';
import { apiFetch, getTenantOverride } from '../../../lib/apiClient';
vi.mock('../../../lib/apiClient', () => ({ apiFetch: vi.fn(), getTenantOverride: vi.fn(() => null) }));
afterEach(() => { cleanup(); vi.resetAllMocks(); });
const response = (value: unknown, ok = true) => ({ ok, json: async () => value }) as Response;
describe('Acompanhamento manual', () => {
  it('exibe também o horário dos retornos criados no CRM', async () => {
    const dueDate = '2026-11-21T14:30:00.000Z';
    vi.mocked(apiFetch).mockResolvedValueOnce(response({ leads: [{ phone: '123', tasks: [{ id: 'scheduled', title: 'Retorno com horário', dueDate, completed: false, assignedOperator: '' }] }] }));
    render(<ManualFollowUp phone="123" />);
    const expected = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(dueDate));
    expect(await screen.findByText(expected)).toBeTruthy();
  });
  it('preserva tarefas recentes e registra retorno no CRM sem chamar IA', async () => {
    const existing = { id: 'other', title: 'Tarefa de outro operador', dueDate: '2026-11-20', completed: false, assignedOperator: 'Ana' };
    vi.mocked(apiFetch).mockResolvedValueOnce(response({ leads: [{ phone: '123', assignedOperator: 'Ana', tasks: [] }] }))
      .mockResolvedValueOnce(response({ leads: [{ phone: '123', tasks: [existing] }] }))
      .mockImplementationOnce(async (_path, options) => response({ leadState: { phone: '123', ...JSON.parse(String(options?.body)) } }));
    render(<ManualFollowUp phone="123" />);
    await waitFor(() => expect((screen.getByLabelText('Responsável') as HTMLInputElement).value).toBe('Ana'));
    fireEvent.change(screen.getByLabelText('Retorno / tarefa'), { target: { value: 'Confirmar serviço' } });
    fireEvent.change(screen.getByLabelText('Data de retorno'), { target: { value: '2026-11-21' } });
    fireEvent.click(screen.getByText('Salvar acompanhamento'));
    await screen.findByText('Acompanhamento salvo.');
    const [url, options] = vi.mocked(apiFetch).mock.calls[2];
    expect(url).toBe('/api/crm/leads/123');
    const patch = JSON.parse(String(options?.body));
    expect(patch.tasks[0]).toEqual(existing);
    expect(patch.tasks[1]).toMatchObject({ title: 'Confirmar serviço', dueDate: '2026-11-21', assignedOperator: 'Ana', completed: false });
    expect(patch.assignedOperator).toBe('Ana');
    expect(vi.mocked(apiFetch).mock.calls.every(([path]) => String(path).startsWith('/api/crm/leads'))).toBe(true);
  });
  it('mostra falha de gravação e conserva o rascunho', async () => {
    vi.mocked(apiFetch).mockResolvedValueOnce(response({ leads: [] }))
      .mockResolvedValueOnce(response({ leads: [] }))
      .mockResolvedValueOnce(response({ error: 'Falha ao salvar' }, false));
    render(<ManualFollowUp phone="456" />);
    await waitFor(() => expect((screen.getByText('Salvar acompanhamento') as HTMLButtonElement).disabled).toBe(false));
    fireEvent.change(screen.getByLabelText('Retorno / tarefa'), { target: { value: 'Retomar conversa' } });
    fireEvent.change(screen.getByLabelText('Data de retorno'), { target: { value: '2026-11-22' } });
    fireEvent.click(screen.getByText('Salvar acompanhamento'));
    await screen.findByRole('alert');
    expect((screen.getByLabelText('Retorno / tarefa') as HTMLInputElement).value).toBe('Retomar conversa');
    expect(screen.queryByText('Acompanhamento salvo.')).toBeNull();
  });
  it('não grava quando a empresa muda enquanto busca tarefas recentes', async () => {
    vi.mocked(getTenantOverride).mockReturnValue('empresa-a');
    vi.mocked(apiFetch).mockResolvedValueOnce(response({ leads: [] }))
      .mockImplementationOnce(async () => {
        vi.mocked(getTenantOverride).mockReturnValue('empresa-b');
        return response({ leads: [] });
      });
    render(<ManualFollowUp phone="789" />);
    await waitFor(() => expect((screen.getByText('Salvar acompanhamento') as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByText('Salvar acompanhamento'));
    await screen.findByRole('alert');
    expect(vi.mocked(apiFetch).mock.calls.some(([, options]) => options?.method === 'PATCH')).toBe(false);
  });

});
