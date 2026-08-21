import { describe, expect, it } from 'vitest';
import type { FinancialTransaction } from '../types';
import { summarizeFinancialTransactions } from './agendaFinanceiroMetrics';

const transaction = (overrides: Partial<FinancialTransaction>): FinancialTransaction => ({
  id: crypto.randomUUID(),
  leadId: 'lead-1',
  leadName: 'Cliente',
  leadPhone: '595981000000',
  productName: 'Serviço',
  amount: 0,
  paymentMethod: 'PIX',
  status: 'pago',
  date: '2026-08-10T12:00:00.000Z',
  operatorName: 'Operador',
  channel: 'Teste',
  ...overrides,
});

describe('summarizeFinancialTransactions', () => {
  it('separa receitas recebidas, valores em aberto e despesas sem somar saídas como receita', () => {
    const summary = summarizeFinancialTransactions([
      transaction({ amount: 500, status: 'pago', entryType: 'income' }),
      transaction({ amount: 120, status: 'pendente', entryType: 'income' }),
      transaction({ amount: 80, status: 'atrasado', entryType: 'income' }),
      transaction({ amount: 200, status: 'pago', entryType: 'expense' }),
      transaction({ amount: 40, status: 'cancelado', entryType: 'expense' }),
    ], 'month', new Date('2026-08-21T12:00:00.000Z'));

    expect(summary.received).toBe(500);
    expect(summary.open).toBe(200);
    expect(summary.overdue).toBe(80);
    expect(summary.spent).toBe(200);
    expect(summary.net).toBe(300);
  });

  it('não trata lançamentos de meses anteriores como resultado do mês atual', () => {
    const summary = summarizeFinancialTransactions([
      transaction({ amount: 700, date: '2026-07-31T12:00:00.000Z', entryType: 'income' }),
      transaction({ amount: 300, date: '2026-08-01T12:00:00.000Z', entryType: 'income' }),
    ], 'month', new Date('2026-08-21T12:00:00.000Z'));

    expect(summary.received).toBe(300);
  });
});
