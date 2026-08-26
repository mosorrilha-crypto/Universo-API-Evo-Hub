/**
 * Job diário de despesas recorrentes (TASK-0097): transforma cada
 * recurring_expenses ativa numa financial_transaction real (entryType
 * 'expense') no dia do mês configurado (day_of_month), sem exigir que o
 * operador digite a mesma despesa fixa (aluguel, assinatura...) todo mês.
 *
 * Idempotência em duas camadas, mesmo padrão dos outros jobs periódicos
 * desta base: `last_generated_month` evita gerar duas vezes no mesmo dia se
 * o job rodar mais de uma vez, e o `source_ref` único por tenant
 * (recurring:<id>:<YYYY-MM>, mesma constraint da migration 0037) é a rede de
 * segurança final contra duplicata mesmo numa corrida entre processos.
 */
import crypto from 'crypto';
import { createFinancialTransaction, isDuplicateSourceRefError } from './financialStore';
import {
  listTenantIdsWithActiveRecurringExpenses,
  listActiveRecurringExpenses,
  markRecurringExpenseGenerated,
  type RecurringExpenseRecord,
} from './recurringExpenseStore';
import { startPeriodicJob } from './periodicJob';
import { runWithTenantDbContext } from './tenantDbContext';

// Mesmo raciocínio de fuso fixo de reminderJob.ts — negócio opera em UTC-3 o
// ano todo, sem depender da regra sazonal desatualizada de America/Asuncion
// em algumas versões de ICU.
const BUSINESS_TIMEZONE = 'Etc/GMT+3';
const DEFAULT_INTERVAL_MS = 60 * 60 * 1000; // a cada hora — barato o bastante pra rodar assim, só grava quando o dia bate

function todayInTz(): { day: number; month: string } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: BUSINESS_TIMEZONE,
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date());
  const get = (type: string) => parts.find((p) => p.type === type)?.value || '';
  return { day: Number(get('day')), month: `${get('year')}-${get('month')}` };
}

async function generateForTenant(tenantId: string, today: { day: number; month: string }): Promise<void> {
  let expenses: RecurringExpenseRecord[];
  try {
    expenses = await listActiveRecurringExpenses(tenantId);
  } catch (err) {
    console.warn(`⚠️  [Despesa recorrente] tenant=${tenantId} falha ao listar despesas recorrentes:`, (err as Error).message);
    return;
  }

  for (const expense of expenses) {
    if (expense.dayOfMonth !== today.day) continue;
    if (expense.lastGeneratedMonth === today.month) continue;

    try {
      await createFinancialTransaction(tenantId, {
        id: crypto.randomUUID(),
        leadId: 'recorrente',
        leadName: 'Despesa recorrente',
        leadPhone: '',
        productName: expense.description,
        amount: expense.amount,
        paymentMethod: expense.paymentMethod,
        status: 'pago',
        date: new Date().toISOString(),
        operatorName: 'Despesa recorrente (automático)',
        channel: 'Despesa recorrente',
        sourceRef: `recurring:${expense.id}:${today.month}`,
        entryType: 'expense',
      });
    } catch (err) {
      if (!isDuplicateSourceRefError(err)) {
        console.warn(`⚠️  [Despesa recorrente] tenant=${tenantId} falha ao gerar lançamento de "${expense.description}":`, (err as Error).message);
        continue;
      }
      // Já gerado por uma execução concorrente — segue pra marcar o mês mesmo assim.
    }

    try {
      await markRecurringExpenseGenerated(tenantId, expense.id, today.month);
      console.log(`💸 [Despesa recorrente] tenant=${tenantId} gerou "${expense.description}" (${today.month}).`);
    } catch (err) {
      console.warn(`⚠️  [Despesa recorrente] tenant=${tenantId} falha ao marcar "${expense.description}" como gerada:`, (err as Error).message);
    }
  }
}

/** Uma passada do job (todos os tenants com despesa recorrente ativa) — exportada separada do setInterval pra ser chamada diretamente nos testes. */
export async function generateDueRecurringExpenses(): Promise<void> {
  let tenantIds: string[];
  try {
    tenantIds = await listTenantIdsWithActiveRecurringExpenses();
  } catch (err) {
    console.warn('⚠️  [Despesa recorrente] Falha ao listar tenants com despesa recorrente ativa:', (err as Error).message);
    return;
  }
  const today = todayInTz();
  for (const tenantId of tenantIds) {
    await runWithTenantDbContext({ tenantId, source: 'job' }, () => generateForTenant(tenantId, today));
  }
}

export interface RecurringExpenseJobDeps {
  intervalMs?: number;
}

/** Roda uma vez imediatamente e depois a cada `intervalMs` (padrão 1h) — mesmo padrão de startHeldAppointmentExpiryJob. */
export function startRecurringExpenseJob(deps: RecurringExpenseJobDeps = {}): void {
  const intervalMs = deps.intervalMs ?? DEFAULT_INTERVAL_MS;
  startPeriodicJob(
    'despesas-recorrentes',
    intervalMs,
    generateDueRecurringExpenses,
    (err) => console.warn('⚠️  [Despesa recorrente] Erro no job:', err instanceof Error ? err.message : String(err)),
  );
}
