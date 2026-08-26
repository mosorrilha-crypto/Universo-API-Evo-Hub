-- TASK-0097 — despesas recorrentes no Financeiro: até aqui uma despesa fixa
-- (aluguel, assinatura, taxa mensal) precisava ser digitada de novo à mão
-- todo mês em "Registrar Despesa". Cadastra a despesa uma vez com um dia do
-- mês de vencimento; um job diário (ver server/services/recurringExpenseJob.ts)
-- gera a financial_transaction correspondente quando o dia chega, sem
-- duplicar (source_ref único por tenant, mesma constraint da migration 0037).
--
-- day_of_month limitado a 1..28 de propósito — evita o caso de um vencimento
-- "dia 30/31" nunca cair em meses mais curtos (fevereiro).
create table if not exists public.recurring_expenses (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  description text not null,
  amount numeric not null check (amount > 0),
  payment_method text not null,
  day_of_month integer not null check (day_of_month between 1 and 28),
  active boolean not null default true,
  -- "YYYY-MM" do último mês em que já gerou a transação — evita gerar duas
  -- vezes no mesmo mês se o job rodar mais de uma vez no mesmo dia.
  last_generated_month text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists recurring_expenses_tenant_active_idx
  on public.recurring_expenses (tenant_id, active);

alter table public.recurring_expenses enable row level security;
alter table public.recurring_expenses force row level security;
drop policy if exists tenant_jwt_isolation on public.recurring_expenses;
create policy tenant_jwt_isolation on public.recurring_expenses
  for all to authenticated
  using (tenant_id = (select public.current_runtime_tenant_id()))
  with check (tenant_id = (select public.current_runtime_tenant_id()));
