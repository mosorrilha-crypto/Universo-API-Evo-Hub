/**
 * Contas a Pagar e Receber: título é previsão; liquidação é dinheiro confirmado.
 * Cada operação é filtrada por tenant_id e a API somente é exposta com sales.financial.
 */
import { getDb } from './db';
import { createFinancialTransaction, type PaymentMethod } from './financialStore';

export type FinancialTitleDirection = 'payable' | 'receivable';
export type FinancialTitleStatus = 'open' | 'overdue' | 'partial' | 'settled' | 'cancelled';

export interface FinancialTitleRecord {
  id: string;
  direction: FinancialTitleDirection;
  status: FinancialTitleStatus;
  description: string;
  counterpartyName: string;
  counterpartyReference?: string;
  originalAmount: number;
  openAmount: number;
  issueDate: string;
  dueDate: string;
  competenceDate?: string;
  paymentMethod?: PaymentMethod;
  categoryId?: string;
  purchaseOrderId?: string;
  sourceRef?: string;
  notes?: string;
}

export interface FinancialTitleSettlementRecord {
  id: string;
  financialTitleId: string;
  financialAccountId: string;
  financialTransactionId?: string;
  amount: number;
  paymentMethod: PaymentMethod;
  settledAt: string;
  notes?: string;
}

type FinancialTitleRow = {
  id: string; direction: FinancialTitleDirection; status: FinancialTitleStatus; description: string;
  counterparty_name: string; counterparty_reference: string | null; original_amount: number; open_amount: number;
  issue_date: string; due_date: string; competence_date: string | null; payment_method: PaymentMethod | null;
  category_id: string | null; purchase_order_id: string | null; source_ref: string | null; notes: string | null;
};
type FinancialTitleSettlementRow = {
  id: string; financial_title_id: string; financial_account_id: string; financial_transaction_id: string | null;
  amount: number; payment_method: PaymentMethod; settled_at: string; notes: string | null;
};

const TITLE_COLUMNS = 'id, direction, status, description, counterparty_name, counterparty_reference, original_amount, open_amount, issue_date, due_date, competence_date, payment_method, category_id, purchase_order_id, source_ref, notes';
const SETTLEMENT_COLUMNS = 'id, financial_title_id, financial_account_id, financial_transaction_id, amount, payment_method, settled_at, notes';

const toTitle = (row: FinancialTitleRow): FinancialTitleRecord => ({
  id: row.id, direction: row.direction, status: row.status, description: row.description,
  counterpartyName: row.counterparty_name, counterpartyReference: row.counterparty_reference || undefined,
  originalAmount: Number(row.original_amount), openAmount: Number(row.open_amount), issueDate: row.issue_date,
  dueDate: row.due_date, competenceDate: row.competence_date || undefined, paymentMethod: row.payment_method || undefined,
  categoryId: row.category_id || undefined, purchaseOrderId: row.purchase_order_id || undefined,
  sourceRef: row.source_ref || undefined, notes: row.notes || undefined,
});
const toSettlement = (row: FinancialTitleSettlementRow): FinancialTitleSettlementRecord => ({
  id: row.id, financialTitleId: row.financial_title_id, financialAccountId: row.financial_account_id,
  financialTransactionId: row.financial_transaction_id || undefined, amount: Number(row.amount),
  paymentMethod: row.payment_method, settledAt: row.settled_at, notes: row.notes || undefined,
});

function dateOnly(value: string): string {
  return value.slice(0, 10);
}

export async function listFinancialTitles(tenantId: string): Promise<FinancialTitleRecord[]> {
  const { data, error } = await getDb().from('financial_titles').select(TITLE_COLUMNS).eq('tenant_id', tenantId).order('due_date');
  if (error) throw error;
  const today = new Date().toISOString().slice(0, 10);
  return (data as FinancialTitleRow[] || []).map((row) => {
    const title = toTitle(row);
    return title.status === 'open' && title.dueDate < today ? { ...title, status: 'overdue' } : title;
  });
}

export async function listFinancialTitleSettlements(tenantId: string, titleId: string): Promise<FinancialTitleSettlementRecord[]> {
  const { data, error } = await getDb().from('financial_title_settlements').select(SETTLEMENT_COLUMNS).eq('tenant_id', tenantId).eq('financial_title_id', titleId).order('settled_at', { ascending: false });
  if (error) throw error;
  return (data as FinancialTitleSettlementRow[] || []).map(toSettlement);
}

export async function createFinancialTitle(tenantId: string, input: Omit<FinancialTitleRecord, 'id' | 'status' | 'openAmount'>): Promise<FinancialTitleRecord> {
  const db = getDb();
  if (input.categoryId) {
    const { data, error } = await db.from('financial_categories').select('id').eq('tenant_id', tenantId).eq('id', input.categoryId).maybeSingle();
    if (error) throw error;
    if (!data) throw new Error('A categoria informada não pertence a esta empresa.');
  }
  const { data, error } = await db.from('financial_titles').insert({
    id: crypto.randomUUID(), tenant_id: tenantId, direction: input.direction, status: 'open',
    description: input.description, counterparty_name: input.counterpartyName,
    counterparty_reference: input.counterpartyReference, original_amount: input.originalAmount,
    open_amount: input.originalAmount, issue_date: dateOnly(input.issueDate), due_date: dateOnly(input.dueDate),
    competence_date: input.competenceDate ? dateOnly(input.competenceDate) : undefined,
    payment_method: input.paymentMethod, category_id: input.categoryId, purchase_order_id: input.purchaseOrderId,
    source_ref: input.sourceRef, notes: input.notes,
  }).select(TITLE_COLUMNS).single();
  if (error) throw error;
  return toTitle(data as FinancialTitleRow);
}

export async function settleFinancialTitle(tenantId: string, titleId: string, input: { amount: number; financialAccountId: string; paymentMethod: PaymentMethod; settledAt?: string; notes?: string; operatorName?: string }): Promise<{ title: FinancialTitleRecord; settlement: FinancialTitleSettlementRecord }> {
  const db = getDb();
  const { data: rawTitle, error: titleError } = await db.from('financial_titles').select(TITLE_COLUMNS).eq('tenant_id', tenantId).eq('id', titleId).maybeSingle();
  if (titleError) throw titleError;
  if (!rawTitle) throw new Error('Título financeiro não encontrado.');
  const title = toTitle(rawTitle as FinancialTitleRow);
  if (title.status === 'cancelled' || title.status === 'settled') throw new Error('Este título não pode receber novas baixas.');
  if (!Number.isFinite(input.amount) || input.amount <= 0 || input.amount > title.openAmount) throw new Error('O valor da baixa deve ser maior que zero e não pode superar o saldo aberto.');
  const { data: account, error: accountError } = await db.from('financial_accounts').select('id, name').eq('tenant_id', tenantId).eq('id', input.financialAccountId).maybeSingle();
  if (accountError) throw accountError;
  if (!account) throw new Error('A conta financeira informada não pertence a esta empresa.');

  const settledAt = input.settledAt || new Date().toISOString();
  const settlementId = crypto.randomUUID();
  const transaction = await createFinancialTransaction(tenantId, {
    id: crypto.randomUUID(), leadId: title.counterpartyReference || `title:${title.id}`,
    leadName: title.counterpartyName, leadPhone: 'N/A', productName: title.description, amount: input.amount,
    paymentMethod: input.paymentMethod, status: 'pago', date: settledAt, operatorName: input.operatorName,
    channel: title.direction === 'receivable' ? 'Conta a receber' : 'Conta a pagar',
    sourceRef: `title-settlement:${title.id}:${settlementId}`,
    entryType: title.direction === 'receivable' ? 'income' : 'expense', categoryId: title.categoryId,
    accountId: input.financialAccountId, notes: input.notes,
  });
  const { data: rawSettlement, error: settlementError } = await db.from('financial_title_settlements').insert({
    id: settlementId, tenant_id: tenantId, financial_title_id: title.id, financial_account_id: input.financialAccountId,
    financial_transaction_id: transaction.id, amount: input.amount, payment_method: input.paymentMethod,
    settled_at: settledAt, notes: input.notes,
  }).select(SETTLEMENT_COLUMNS).single();
  if (settlementError) throw settlementError;

  const nextOpenAmount = Number((title.openAmount - input.amount).toFixed(2));
  const nextStatus: FinancialTitleStatus = nextOpenAmount === 0 ? 'settled' : 'partial';
  const { data: rawUpdated, error: updateError } = await db.from('financial_titles').update({ open_amount: nextOpenAmount, status: nextStatus, updated_at: new Date().toISOString() }).eq('tenant_id', tenantId).eq('id', title.id).select(TITLE_COLUMNS).single();
  if (updateError) throw updateError;
  return { title: toTitle(rawUpdated as FinancialTitleRow), settlement: toSettlement(rawSettlement as FinancialTitleSettlementRow) };
}
