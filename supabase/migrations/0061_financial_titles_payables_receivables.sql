-- Contas a pagar e receber tenant-scoped.
-- Título representa obrigação ou direito previsto; liquidação representa dinheiro confirmado.

create table if not exists public.financial_titles (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  direction text not null check (direction in ('payable', 'receivable')),
  status text not null default 'open' check (status in ('open', 'overdue', 'partial', 'settled', 'cancelled')),
  description text not null check (char_length(trim(description)) between 2 and 180),
  counterparty_name text not null check (char_length(trim(counterparty_name)) between 2 and 120),
  counterparty_reference text,
  original_amount numeric not null check (original_amount > 0),
  open_amount numeric not null check (open_amount >= 0),
  issue_date date not null default current_date,
  due_date date not null,
  competence_date date,
  payment_method text,
  category_id uuid references public.financial_categories(id) on delete set null,
  purchase_order_id uuid references public.purchase_orders(id) on delete set null,
  source_ref text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, source_ref),
  check (open_amount <= original_amount)
);

create table if not exists public.financial_title_settlements (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  financial_title_id uuid not null references public.financial_titles(id) on delete restrict,
  financial_account_id uuid not null references public.financial_accounts(id) on delete restrict,
  financial_transaction_id uuid references public.financial_transactions(id) on delete set null,
  amount numeric not null check (amount > 0),
  payment_method text not null,
  settled_at timestamptz not null default now(),
  notes text,
  created_at timestamptz not null default now()
);

alter table public.purchase_orders
  add column if not exists financial_title_id uuid references public.financial_titles(id) on delete set null;

create index if not exists financial_titles_tenant_due_idx
  on public.financial_titles (tenant_id, direction, status, due_date);
create index if not exists financial_titles_tenant_source_idx
  on public.financial_titles (tenant_id, source_ref);
create index if not exists financial_title_settlements_tenant_title_idx
  on public.financial_title_settlements (tenant_id, financial_title_id, settled_at desc);

alter table public.financial_titles enable row level security;
alter table public.financial_titles force row level security;
alter table public.financial_title_settlements enable row level security;
alter table public.financial_title_settlements force row level security;

drop policy if exists tenant_jwt_isolation on public.financial_titles;
create policy tenant_jwt_isolation on public.financial_titles
  for all to authenticated
  using (tenant_id = (select public.current_runtime_tenant_id()))
  with check (tenant_id = (select public.current_runtime_tenant_id()));

drop policy if exists tenant_jwt_isolation on public.financial_title_settlements;
create policy tenant_jwt_isolation on public.financial_title_settlements
  for all to authenticated
  using (tenant_id = (select public.current_runtime_tenant_id()))
  with check (tenant_id = (select public.current_runtime_tenant_id()));
