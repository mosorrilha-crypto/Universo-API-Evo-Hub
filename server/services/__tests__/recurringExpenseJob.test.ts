/**
 * TASK-0097 — job diário que transforma cada despesa recorrente ativa numa
 * financial_transaction real, no dia do mês configurado, sem duplicar se
 * rodar mais de uma vez no mesmo dia (last_generated_month).
 */
import { describe, expect, it, beforeEach } from 'vitest';
import { initDb } from '../db';
import { createFakeSupabase } from './fakeSupabase';
import { createRecurringExpense, listRecurringExpenses } from '../recurringExpenseStore';
import { listFinancialTransactions } from '../financialStore';
import { generateDueRecurringExpenses } from '../recurringExpenseJob';

const TENANT_A = 'tenant-a';

let supabase: ReturnType<typeof createFakeSupabase>;

const BUSINESS_TIMEZONE = 'Etc/GMT+3';
function todayInTz(): { day: number; month: string } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: BUSINESS_TIMEZONE,
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date());
  const get = (type: string) => parts.find((p) => p.type === type)?.value || '';
  return { day: Number(get('day')), month: `${get('year')}-${get('month')}` };
}

beforeEach(() => {
  supabase = createFakeSupabase();
  initDb(supabase);
});

describe('generateDueRecurringExpenses', () => {
  it('gera a transação quando o dia de hoje bate com dayOfMonth e ainda não foi gerada este mês', async () => {
    const today = todayInTz();
    await createRecurringExpense(TENANT_A, { description: 'Aluguel', amount: 1500000, paymentMethod: 'Transferência Bancária', dayOfMonth: today.day });

    await generateDueRecurringExpenses();

    const transactions = await listFinancialTransactions(TENANT_A);
    expect(transactions).toHaveLength(1);
    expect(transactions[0]).toMatchObject({ productName: 'Aluguel', amount: 1500000, entryType: 'expense', status: 'pago' });
    expect(transactions[0].sourceRef).toMatch(/^recurring:.+:/);

    const [expense] = await listRecurringExpenses(TENANT_A);
    expect(expense.lastGeneratedMonth).toBe(today.month);
  });

  it('não gera nada quando o dia de hoje não bate com dayOfMonth', async () => {
    const today = todayInTz();
    const otherDay = today.day === 1 ? 2 : 1;
    await createRecurringExpense(TENANT_A, { description: 'Assinatura', amount: 200000, paymentMethod: 'PIX', dayOfMonth: otherDay });

    await generateDueRecurringExpenses();

    expect(await listFinancialTransactions(TENANT_A)).toHaveLength(0);
  });

  it('não gera duas vezes no mesmo mês se o job rodar de novo', async () => {
    const today = todayInTz();
    await createRecurringExpense(TENANT_A, { description: 'Aluguel', amount: 1500000, paymentMethod: 'Transferência Bancária', dayOfMonth: today.day });

    await generateDueRecurringExpenses();
    await generateDueRecurringExpenses();

    expect(await listFinancialTransactions(TENANT_A)).toHaveLength(1);
  });

  it('não gera despesa pausada (active: false)', async () => {
    const today = todayInTz();
    const created = await createRecurringExpense(TENANT_A, { description: 'Pausada', amount: 300000, paymentMethod: 'PIX', dayOfMonth: today.day });
    const { updateRecurringExpense } = await import('../recurringExpenseStore');
    await updateRecurringExpense(TENANT_A, created.id, { active: false });

    await generateDueRecurringExpenses();

    expect(await listFinancialTransactions(TENANT_A)).toHaveLength(0);
  });

  it('sem nenhuma despesa recorrente cadastrada, não faz nada', async () => {
    await generateDueRecurringExpenses();
    expect(await listFinancialTransactions(TENANT_A)).toHaveLength(0);
  });
});
