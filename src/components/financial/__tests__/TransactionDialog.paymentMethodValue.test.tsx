// @vitest-environment jsdom
/**
 * Achado real (print, tenant paraguaio): "não consigo finalizar o
 * lançamento, não salva". A opção do <select> de forma de pagamento não
 * tinha `value=` explícito — o valor submetido virava o TEXTO exibido
 * (traduzido em `isSpanish`, ex: "Transferencia bancaria"), não o valor
 * canônico em português que o servidor valida (`PAYMENT_METHODS` em
 * financial.ts). Qualquer forma diferente de PIX num tenant em espanhol
 * fazia o servidor rejeitar o lançamento com 400 — e o erro ficava
 * invisível atrás do próprio modal (corrigido à parte, no z-index do toast
 * em App.tsx), então na prática parecia que o botão não fazia nada.
 */
import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PAYMENT_METHODS, TransactionDialog } from '../TransactionDialog';

afterEach(() => cleanup());

describe('TransactionDialog — valor submetido da forma de pagamento (isSpanish)', () => {
  it('submete o valor canônico em português mesmo com o rótulo traduzido em espanhol', async () => {
    const user = userEvent.setup();
    let submittedPaymentMethod: string | null = null;
    render(
      <TransactionDialog
        kind="income"
        leads={[]}
        currency="PYG"
        isSpanish
        onClose={vi.fn()}
        onSubmit={(e) => {
          e.preventDefault();
          submittedPaymentMethod = String(new FormData(e.currentTarget).get('paymentMethod'));
        }}
        submitting={false}
      />
    );

    await user.selectOptions(screen.getByLabelText('Forma'), 'Transferencia bancaria');
    await user.type(screen.getByLabelText('Descripción'), 'Venta presencial');
    await user.type(screen.getByLabelText(/Valor/), '30000');
    await user.click(screen.getByRole('button', { name: 'Registrar ingreso' }));

    expect(submittedPaymentMethod).toBe('Transferência Bancária');
    expect(PAYMENT_METHODS).toContain(submittedPaymentMethod);
  });
});
