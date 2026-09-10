// @vitest-environment jsdom
/**
 * TASK-0375 (pedido direto): a "Ficha do Contato" vira um mini-prontuário —
 * remove o círculo de avatar (nunca havia foto real ali, a Meta Cloud API
 * não expõe foto de perfil de contato), aumenta o destaque do nome, o botão
 * "Copiar" passa a copiar um bloco de texto formatado (não só o telefone
 * cru), "Observações" para de cortar com reticências, e ganha edição inline
 * (mesmo campo `conversation_summary` já editável na Ficha IA).
 */
import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConversationContextSidebar } from '../ConversationContextSidebar';
import type { ContactProfileData } from '../ownerPanelTypes';

afterEach(() => cleanup());

const LONG_NOTE = 'Cliente pediu para remarcar para a tarde, prefere terças ou quintas, já perguntou sobre o preço do combo completo duas vezes nesta semana.';

const baseContact: ContactProfileData = {
  name: 'Gisela Mariel',
  phone: '595992482568',
  interest: 'Combo Micro Cejas + Labios',
  hasBooked: false,
  firstContactAt: '20:53',
  notes: LONG_NOTE,
};

describe('ConversationContextSidebar — prontuário', () => {
  it('não renderiza mais o círculo de avatar com iniciais', () => {
    render(<ConversationContextSidebar contact={baseContact} agentStatus="active" />);
    expect(screen.queryByText('G')).toBeNull();
  });

  it('nome aparece com destaque maior (text-xl)', () => {
    render(<ConversationContextSidebar contact={baseContact} agentStatus="active" />);
    const heading = screen.getByText('Gisela Mariel');
    expect(heading.className).toContain('text-xl');
  });

  it('Observações mostra o texto inteiro, sem truncar', () => {
    render(<ConversationContextSidebar contact={baseContact} agentStatus="active" />);
    const notes = screen.getByText(LONG_NOTE);
    expect(notes.className).not.toContain('truncate');
  });

  it('botão "Copiar ficha" copia um bloco de texto formatado com os campos da ficha', () => {
    const writeText = vi.fn();
    Object.assign(navigator, { clipboard: { writeText } });

    render(<ConversationContextSidebar contact={baseContact} agentStatus="active" />);
    fireEvent.click(screen.getByText('Copiar ficha'));

    expect(writeText).toHaveBeenCalledTimes(1);
    const copied = writeText.mock.calls[0][0] as string;
    expect(copied).toContain('Nome: Gisela Mariel');
    expect(copied).toContain('Telefone: 595992482568');
    expect(copied).toContain('Interesse: Combo Micro Cejas + Labios');
    expect(copied).toContain('Agendou?: não');
    expect(copied).toContain(`Observações: ${LONG_NOTE}`);
  });

  it('sem onSaveMemory, o lápis de edição de Observações não aparece', () => {
    render(<ConversationContextSidebar contact={baseContact} agentStatus="active" />);
    expect(screen.queryByTitle('Editar observações')).toBeNull();
  });

  it('com onSaveMemory, edita Observações inline e salva só o conversationSummary', async () => {
    const onSaveMemory = vi.fn(async () => undefined);
    render(<ConversationContextSidebar contact={baseContact} agentStatus="active" onSaveMemory={onSaveMemory} />);

    fireEvent.click(screen.getByTitle('Editar observações'));
    const textarea = screen.getByDisplayValue(LONG_NOTE);
    fireEvent.change(textarea, { target: { value: 'Prefere atendimento às terças à tarde.' } });
    fireEvent.click(screen.getByText('Salvar'));

    expect(onSaveMemory).toHaveBeenCalledWith({ conversationSummary: 'Prefere atendimento às terças à tarde.' });
  });

  it('cancelar a edição não chama onSaveMemory e restaura o texto original', () => {
    const onSaveMemory = vi.fn(async () => undefined);
    render(<ConversationContextSidebar contact={baseContact} agentStatus="active" onSaveMemory={onSaveMemory} />);

    fireEvent.click(screen.getByTitle('Editar observações'));
    fireEvent.change(screen.getByDisplayValue(LONG_NOTE), { target: { value: 'rascunho descartado' } });
    fireEvent.click(screen.getByText('Cancelar'));

    expect(onSaveMemory).not.toHaveBeenCalled();
    expect(screen.getByText(LONG_NOTE)).not.toBeNull();
  });
});
