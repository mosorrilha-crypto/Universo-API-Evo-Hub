-- Central Agenda & Financeiro: diferencia receitas, despesas e cobranças
-- originadas de agendamentos sem criar uma tabela paralela.
alter table public.financial_transactions
  add column if not exists entry_type text not null default 'income';

alter table public.financial_transactions
  drop constraint if exists financial_transactions_entry_type_check;

alter table public.financial_transactions
  add constraint financial_transactions_entry_type_check
  check (entry_type in ('income', 'expense'));

create index if not exists financial_transactions_tenant_entry_type_date_idx
  on public.financial_transactions (tenant_id, entry_type, date desc);
