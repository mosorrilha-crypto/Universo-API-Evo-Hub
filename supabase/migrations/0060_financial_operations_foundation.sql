-- TASK Financeiro expandido — fundação operacional por tenant.
-- Categorias e contas dão contexto aos lançamentos; itens, compras e
-- movimentações mantêm o estoque rastreável sem misturar tenants.

create table if not exists public.financial_categories (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  name text not null check (char_length(trim(name)) between 2 and 80),
  kind text not null check (kind in ('income', 'expense', 'cost')),
  color text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, name, kind)
);

create table if not exists public.financial_accounts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  name text not null check (char_length(trim(name)) between 2 and 80),
  account_type text not null check (account_type in ('cash', 'bank', 'digital_wallet', 'card')),
  opening_balance numeric not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, name)
);

alter table public.financial_transactions
  add column if not exists category_id uuid references public.financial_categories(id) on delete set null,
  add column if not exists account_id uuid references public.financial_accounts(id) on delete set null,
  add column if not exists notes text;

create index if not exists financial_transactions_tenant_category_date_idx
  on public.financial_transactions (tenant_id, category_id, date desc);

create table if not exists public.inventory_items (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  name text not null check (char_length(trim(name)) between 2 and 120),
  sku text,
  item_type text not null check (item_type in ('product', 'supply')),
  unit text not null default 'un',
  on_hand_quantity numeric not null default 0 check (on_hand_quantity >= 0),
  reorder_point numeric not null default 0 check (reorder_point >= 0),
  average_unit_cost numeric not null default 0 check (average_unit_cost >= 0),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, sku)
);

create table if not exists public.purchase_orders (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  supplier_name text not null check (char_length(trim(supplier_name)) between 2 and 120),
  status text not null default 'draft' check (status in ('draft', 'receiving', 'received', 'cancelled')),
  payment_method text not null,
  notes text,
  total_amount numeric not null default 0 check (total_amount >= 0),
  financial_transaction_id uuid references public.financial_transactions(id) on delete set null,
  received_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.purchase_order_items (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  purchase_order_id uuid not null references public.purchase_orders(id) on delete cascade,
  inventory_item_id uuid not null references public.inventory_items(id) on delete restrict,
  quantity numeric not null check (quantity > 0),
  unit_cost numeric not null check (unit_cost >= 0),
  created_at timestamptz not null default now()
);

create table if not exists public.stock_movements (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  inventory_item_id uuid not null references public.inventory_items(id) on delete restrict,
  movement_type text not null check (movement_type in ('purchase_receipt', 'sale', 'service_consumption', 'adjustment_in', 'adjustment_out', 'loss')),
  quantity numeric not null check (quantity > 0),
  unit_cost numeric not null default 0 check (unit_cost >= 0),
  reason text,
  source_ref text,
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (tenant_id, source_ref)
);

create index if not exists inventory_items_tenant_active_idx on public.inventory_items (tenant_id, active);
create index if not exists purchase_orders_tenant_status_idx on public.purchase_orders (tenant_id, status, created_at desc);
create index if not exists purchase_order_items_tenant_order_idx on public.purchase_order_items (tenant_id, purchase_order_id);
create index if not exists stock_movements_tenant_item_date_idx on public.stock_movements (tenant_id, inventory_item_id, occurred_at desc);

alter table public.financial_categories enable row level security;
alter table public.financial_categories force row level security;
alter table public.financial_accounts enable row level security;
alter table public.financial_accounts force row level security;
alter table public.inventory_items enable row level security;
alter table public.inventory_items force row level security;
alter table public.purchase_orders enable row level security;
alter table public.purchase_orders force row level security;
alter table public.purchase_order_items enable row level security;
alter table public.purchase_order_items force row level security;
alter table public.stock_movements enable row level security;
alter table public.stock_movements force row level security;

drop policy if exists tenant_jwt_isolation on public.financial_categories;
create policy tenant_jwt_isolation on public.financial_categories for all to authenticated using (tenant_id = (select public.current_runtime_tenant_id())) with check (tenant_id = (select public.current_runtime_tenant_id()));
drop policy if exists tenant_jwt_isolation on public.financial_accounts;
create policy tenant_jwt_isolation on public.financial_accounts for all to authenticated using (tenant_id = (select public.current_runtime_tenant_id())) with check (tenant_id = (select public.current_runtime_tenant_id()));
drop policy if exists tenant_jwt_isolation on public.inventory_items;
create policy tenant_jwt_isolation on public.inventory_items for all to authenticated using (tenant_id = (select public.current_runtime_tenant_id())) with check (tenant_id = (select public.current_runtime_tenant_id()));
drop policy if exists tenant_jwt_isolation on public.purchase_orders;
create policy tenant_jwt_isolation on public.purchase_orders for all to authenticated using (tenant_id = (select public.current_runtime_tenant_id())) with check (tenant_id = (select public.current_runtime_tenant_id()));
drop policy if exists tenant_jwt_isolation on public.purchase_order_items;
create policy tenant_jwt_isolation on public.purchase_order_items for all to authenticated using (tenant_id = (select public.current_runtime_tenant_id())) with check (tenant_id = (select public.current_runtime_tenant_id()));
drop policy if exists tenant_jwt_isolation on public.stock_movements;
create policy tenant_jwt_isolation on public.stock_movements for all to authenticated using (tenant_id = (select public.current_runtime_tenant_id())) with check (tenant_id = (select public.current_runtime_tenant_id()));
