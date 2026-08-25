-- TASK-0070 (parte 2, pedido direto de chat) — tela de gestão de tenants
-- pro saas_admin: bloqueio de acesso e histórico de pagamento mensal do
-- próprio Universo (cobrança do SaaS ao tenant, distinta de
-- financial_transactions, que é a cobrança do TENANT ao cliente final dele).
--
-- `tenants.is_active`: quando false, login de qualquer operador desse
-- tenant é recusado (server/routes/auth.ts) — bloqueio reversível, sem
-- apagar nada (diferente de DELETE /api/admin/tenants/:id, que já existe e
-- é destrutivo/irreversível).
--
-- `tenant_billing_records`: registro manual (não é gateway de pagamento —
-- mesma decisão de escopo já tomada em financial_transactions/Epic 4.4)
-- de cobrança mensal do Universo pro tenant. Um saas_admin marca cada mês
-- como pago/pendente/atrasado à mão, mesmo padrão operacional já usado pro
-- comprovante de pagamento do cliente final (escalations, kind
-- payment_proof) — decisão humana registrada, IA/sistema nunca confirma
-- pagamento sozinho.
--
-- Como aplicar: via Supabase MCP apply_migration (ver CLAUDE.md) ou, se
-- indisponível, colar no SQL Editor do projeto — idempotente, seguro
-- rodar de novo.

alter table public.tenants
  add column if not exists is_active boolean not null default true;

create table if not exists public.tenant_billing_records (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  reference_month date not null, -- sempre normalizado pro dia 1 do mês de referência (ex: 2026-08-01)
  amount numeric not null,
  currency text not null default 'BRL' check (currency in ('PYG', 'BRL', 'USD')),
  status text not null default 'pendente' check (status in ('pendente', 'pago', 'atrasado')),
  paid_at timestamptz,
  note text,
  created_by text, -- nome/e-mail do saas_admin que registrou, só rastreabilidade
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, reference_month)
);
create index if not exists tenant_billing_records_tenant_idx on public.tenant_billing_records (tenant_id);

alter table public.tenant_billing_records enable row level security;
alter table public.tenant_billing_records force row level security;
drop policy if exists tenant_isolation on public.tenant_billing_records;
create policy tenant_isolation on public.tenant_billing_records
  using (tenant_id = (select current_setting('app.current_tenant_id', true))::uuid)
  with check (tenant_id = (select current_setting('app.current_tenant_id', true))::uuid);
