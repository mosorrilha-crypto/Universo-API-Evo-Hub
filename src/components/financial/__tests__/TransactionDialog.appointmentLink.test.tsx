// @vitest-environment jsdom
/**
 * TASK-0389 — achado real (print): "quando eu marco este comprovante não
 * consigo lincar com um agendamento realizado". O checkbox "Vincular a
 * este agendamento" já existia, mas só aparecia quando o agendamento
 * rastreado do contato ainda estava aguardando aprovação — a chamada
 * (WhatsAppLeadsSim.tsx) agora amplia isso pra qualquer agendamento
 * rastreado, e quando não existe nenhum, oferece "Registrar agora" — este
 * arquivo cobre só a parte de UI do TransactionDialog (a lógica de qual
 * caminho o backend recebe mora em WhatsAppLeadsSim.tsx, cobertura via
 * teste manual/E2E fica fora do escopo de um componente isolado).
 */
import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TransactionDialog } from '../TransactionDialog';

const baseProps = {
  kind: 'income' as const,
  leads: [],
  currency: 'PYG',
  isSpanish: false,
  onClose: vi.fn(),
  onSubmit: vi.fn((e: React.FormEvent) => e.preventDefault()),
  submitting: false,
};

afterEach(() => cleanup());

describe('TransactionDialog — vínculo com agendamento', () => {
  it('mostra o checkbox de vínculo quando há um agendamento rastreado, qualquer que seja o status', () => {
    render(
      <TransactionDialog
        {...baseProps}
        lockedLead={{ name: 'Raquel', phone: '595981749001' }}
        linkableAppointment={{ eventId: 'evt-1', summary: 'Corte + Escova', startIso: '2026-09-05T14:00:00' }}
      />
    );
    expect(screen.getByText(/Vincular a este agendamento/)).not.toBeNull();
    expect(screen.getByText('Corte + Escova')).not.toBeNull();
    expect(screen.queryByText('Registrar agora')).toBeNull();
  });

  it('oferece "Registrar agora" quando não há agendamento rastreado e o callback foi passado', async () => {
    const user = userEvent.setup();
    const onRegisterAppointment = vi.fn();
    render(
      <TransactionDialog
        {...baseProps}
        lockedLead={{ name: 'Raquel', phone: '595981749001' }}
        linkableAppointment={null}
        onRegisterAppointment={onRegisterAppointment}
      />
    );
    expect(screen.getByText('Nenhum agendamento rastreado para este contato.')).not.toBeNull();
    const button = screen.getByRole('button', { name: 'Registrar agora' });
    await user.click(button);
    expect(onRegisterAppointment).toHaveBeenCalledTimes(1);
  });

  it('não mostra nada de vínculo sem lockedLead (uso genérico do Financeiro, fora do chat)', () => {
    render(<TransactionDialog {...baseProps} linkableAppointment={null} />);
    expect(screen.queryByText(/Vincular a este agendamento/)).toBeNull();
    expect(screen.queryByText('Registrar agora')).toBeNull();
  });

  it('não mostra "Registrar agora" quando o callback não foi passado', () => {
    render(
      <TransactionDialog
        {...baseProps}
        lockedLead={{ name: 'Raquel', phone: '595981749001' }}
        linkableAppointment={null}
      />
    );
    expect(screen.queryByText('Registrar agora')).toBeNull();
  });
});
