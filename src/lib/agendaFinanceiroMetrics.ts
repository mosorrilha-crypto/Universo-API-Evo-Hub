import type { FinancialTransaction } from '../types';

export type FinancialPeriod = 'month' | 'all';

/** Consolida somente lançamentos reais já recebidos pela central, sem estimar ROI ou atribuição inexistente. */
export function summarizeFinancialTransactions(
  transactions: FinancialTransaction[],
  period: FinancialPeriod,
  referenceDate = new Date(),
) {
  const startOfMonth = new Date(referenceDate);
  startOfMonth.setDate(1);
  startOfMonth.setHours(0, 0, 0, 0);
  const scoped = period === 'month'
    ? transactions.filter((transaction) => new Date(transaction.date) >= startOfMonth)
    : transactions;
  const income = scoped.filter((transaction) => transaction.entryType !== 'expense');
  const expenses = scoped.filter((transaction) => transaction.entryType === 'expense');
  const received = income.filter((transaction) => transaction.status === 'pago').reduce((total, transaction) => total + transaction.amount, 0);
  const open = income.filter((transaction) => transaction.status === 'pendente' || transaction.status === 'atrasado').reduce((total, transaction) => total + transaction.amount, 0);
  const overdue = income.filter((transaction) => transaction.status === 'atrasado').reduce((total, transaction) => total + transaction.amount, 0);
  const spent = expenses.filter((transaction) => transaction.status !== 'cancelado').reduce((total, transaction) => total + transaction.amount, 0);
  const projectedIncome = income.filter((transaction) => transaction.status !== 'cancelado').reduce((total, transaction) => total + transaction.amount, 0);
  const pendingCount = income.filter((transaction) => transaction.status === 'pendente' || transaction.status === 'atrasado').length;
  const incomeCount = income.filter((transaction) => transaction.status !== 'cancelado').length;
  const expenseCount = expenses.filter((transaction) => transaction.status !== 'cancelado').length;
  const collectionRate = projectedIncome > 0 ? received / projectedIncome : null;
  return { scoped, income, received, open, overdue, spent, net: received - spent, projectedIncome, pendingCount, incomeCount, expenseCount, collectionRate };
}
