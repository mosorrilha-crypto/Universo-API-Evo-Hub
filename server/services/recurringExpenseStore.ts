/**
 * Despesas recorrentes (TASK-0097) — cadastro único de uma despesa fixa
 * (aluguel, assinatura, taxa mensal) que o job diário
 * (recurringExpenseJob.ts) transforma automaticamente numa
 * financial_transaction todo mês, no dia de vencimento configurado. Ver
 * supabase/migrations/0056_recurring_expenses.sql pro desenho completo.
 */
import { getDb, getPlatformDb } from './db';
import type { PaymentMethod } from './financialStore';

export interface RecurringExpenseRecord {
  id: string;
  tenantId: string;
  description: string;
  amount: number;
  paymentMethod: PaymentMethod;
  dayOfMonth: number;
  active: boolean;
  lastGeneratedMonth: string | null;
}

type RecurringExpenseRow = {
  id: string;
  tenant_id: string;
  description: string;
  amount: number;
  payment_method: PaymentMethod;
  day_of_month: number;
  active: boolean;
  last_generated_month: string | null;
};

const RECURRING_EXPENSE_COLUMNS = 'id, tenant_id, description, amount, payment_method, day_of_month, active, last_generated_month';

function toRecurringExpenseRecord(row: RecurringExpenseRow): RecurringExpenseRecord {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    description: row.description,
    amount: row.amount,
    paymentMethod: row.payment_method,
    dayOfMonth: row.day_of_month,
    active: row.active,
    lastGeneratedMonth: row.last_generated_month,
  };
}

/** Todas as despesas recorrentes do tenant (ativas e pausadas), mais recente primeiro. */
export async function listRecurringExpenses(tenantId: string): Promise<RecurringExpenseRecord[]> {
  const db = getDb();
  const { data, error } = await db
    .from('recurring_expenses')
    .select(RECURRING_EXPENSE_COLUMNS)
    .eq('tenant_id', tenantId);
  if (error) throw error;
  return (data as RecurringExpenseRow[]).map(toRecurringExpenseRecord);
}

export interface CreateRecurringExpenseInput {
  description: string;
  amount: number;
  paymentMethod: PaymentMethod;
  dayOfMonth: number;
}

export async function createRecurringExpense(tenantId: string, input: CreateRecurringExpenseInput): Promise<RecurringExpenseRecord> {
  const db = getDb();
  const { data, error } = await db
    .from('recurring_expenses')
    .insert({
      tenant_id: tenantId,
      description: input.description,
      amount: input.amount,
      payment_method: input.paymentMethod,
      day_of_month: input.dayOfMonth,
      active: true,
    })
    .select(RECURRING_EXPENSE_COLUMNS)
    .single();
  if (error) throw error;
  return toRecurringExpenseRecord(data as RecurringExpenseRow);
}

/** Pausa/retoma ou edita uma despesa recorrente já cadastrada — nunca mexe em last_generated_month aqui (só o job controla isso). */
export async function updateRecurringExpense(
  tenantId: string,
  id: string,
  patch: Partial<CreateRecurringExpenseInput & { active: boolean }>
): Promise<RecurringExpenseRecord | null> {
  const db = getDb();
  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (patch.description !== undefined) updates.description = patch.description;
  if (patch.amount !== undefined) updates.amount = patch.amount;
  if (patch.paymentMethod !== undefined) updates.payment_method = patch.paymentMethod;
  if (patch.dayOfMonth !== undefined) updates.day_of_month = patch.dayOfMonth;
  if (patch.active !== undefined) updates.active = patch.active;

  const { data, error } = await db
    .from('recurring_expenses')
    .update(updates)
    .eq('tenant_id', tenantId)
    .eq('id', id)
    .select(RECURRING_EXPENSE_COLUMNS)
    .maybeSingle();
  if (error) throw error;
  return data ? toRecurringExpenseRecord(data as RecurringExpenseRow) : null;
}

export async function deleteRecurringExpense(tenantId: string, id: string): Promise<void> {
  const db = getDb();
  const { error } = await db.from('recurring_expenses').delete().eq('tenant_id', tenantId).eq('id', id);
  if (error) throw error;
}

/** Marca o mês corrente como já gerado — chamado pelo job depois de criar a financial_transaction do mês, pra não gerar duas vezes se rodar de novo no mesmo dia. */
export async function markRecurringExpenseGenerated(tenantId: string, id: string, month: string): Promise<void> {
  const db = getDb();
  const { error } = await db
    .from('recurring_expenses')
    .update({ last_generated_month: month, updated_at: new Date().toISOString() })
    .eq('tenant_id', tenantId)
    .eq('id', id);
  if (error) throw error;
}

/** Todos os tenants com pelo menos uma despesa recorrente ativa — usado pelo job diário pra saber por quem passar (mesmo padrão de listTenantIdsWithExpiredHolds em appointmentStore.ts). */
export async function listTenantIdsWithActiveRecurringExpenses(): Promise<string[]> {
  const db = getPlatformDb();
  const { data, error } = await db.from('recurring_expenses').select('tenant_id').eq('active', true);
  if (error) throw error;
  const ids = new Set(((data || []) as { tenant_id: string }[]).map((row) => row.tenant_id));
  return Array.from(ids);
}

/** Despesas recorrentes ativas de um tenant — usado pelo job diário dentro do contexto desse tenant. */
export async function listActiveRecurringExpenses(tenantId: string): Promise<RecurringExpenseRecord[]> {
  const db = getDb();
  const { data, error } = await db
    .from('recurring_expenses')
    .select(RECURRING_EXPENSE_COLUMNS)
    .eq('tenant_id', tenantId)
    .eq('active', true);
  if (error) throw error;
  return (data as RecurringExpenseRow[]).map(toRecurringExpenseRecord);
}
