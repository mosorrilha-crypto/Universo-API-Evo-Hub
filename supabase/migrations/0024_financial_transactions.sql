-- [Financeiro] Conecta o FinancialDashboard.tsx a dado real por tenant — hoje
-- o painel é 100% mock/localStorage (App.tsx só lê/grava saas_transactions,
-- com fallback pro dataset fictício INITIAL_TRANSACTIONS), então nenhuma
-- cobrança gerada sobrevive a um cache limpo/outro navegador, e nenhum
-- operador diferente do que criou a cobrança consegue vê-la. Mesmo padrão
-- de 0013_crm_lead_state.sql: tabela própria (não coluna extra em nenhuma
-- outra), chave `id` gerada no cliente (o app já monta um FinancialTransaction
-- completo antes de enviar), RLS por tenant_id no formato já otimizado
-- (current_setting(...) com subselect, ver issue #91).
--
-- Nota: o conteúdo de pix_qr_code/payment_link_url continua sendo um
-- placeholder gerado no frontend (Epic 4.4 — decisão de provedor de
-- pagamento real ainda não tomada) — esta tabela só torna o REGISTRO da
-- cobrança real e persistente por tenant, não implementa um gateway de
-- pagamento de verdade.
--
-- Como aplicar: cole este arquivo no SQL Editor do painel Supabase do
-- projeto e rode uma vez. Idempotente, seguro rodar de novo.
create table if not exists public.financial_transactions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  lead_id text not null,
  lead_name text not null,
  lead_phone text not null,
  product_name text not null,
  amount numeric not null,
  payment_method text not null,
  status text not null default 'pendente',
  date timestamptz not null default now(),
  operator_name text,
  channel text,
  pix_qr_code text,
  payment_link_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists financial_transactions_tenant_idx on public.financial_transactions (tenant_id);

alter table public.financial_transactions enable row level security;
alter table public.financial_transactions force row level security;
drop policy if exists tenant_isolation on public.financial_transactions;
create policy tenant_isolation on public.financial_transactions
  using (tenant_id = (select current_setting('app.current_tenant_id', true))::uuid)
  with check (tenant_id = (select current_setting('app.current_tenant_id', true))::uuid);
