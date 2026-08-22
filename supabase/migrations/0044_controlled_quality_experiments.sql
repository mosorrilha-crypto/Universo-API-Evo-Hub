-- Experimentos controlados supervisionados.
-- Esta tabela descreve e acompanha uma avaliação humana. Ela NÃO é lida pelo
-- agente em produção e não contém prompt, conteúdo de conversa, telefone,
-- pagamento, agenda ou qualquer configuração de ativação automática.

create table if not exists public.controlled_quality_experiments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  quality_review_id uuid not null references public.quality_reviews(id) on delete cascade,
  status text not null default 'draft' check (status in ('draft', 'ready', 'running', 'paused', 'completed', 'rejected')),
  hypothesis text not null,
  variation_summary text not null,
  scope_routes jsonb not null default '[]'::jsonb,
  sample_limit integer not null check (sample_limit between 1 and 25),
  success_criteria jsonb not null default '[]'::jsonb,
  stop_conditions jsonb not null default '[]'::jsonb,
  outcome_summary text,
  decision_note text,
  created_by uuid references public.operators(id) on delete set null,
  activated_by uuid references public.operators(id) on delete set null,
  decided_by uuid references public.operators(id) on delete set null,
  started_at timestamptz,
  ended_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, quality_review_id)
);

create index if not exists controlled_quality_experiments_tenant_status_updated_idx
  on public.controlled_quality_experiments (tenant_id, status, updated_at desc);

alter table public.controlled_quality_experiments enable row level security;

drop policy if exists controlled_quality_experiments_tenant_access on public.controlled_quality_experiments;
create policy controlled_quality_experiments_tenant_access on public.controlled_quality_experiments
  for all using (tenant_id = (select current_setting('app.current_tenant_id', true))::uuid)
  with check (tenant_id = (select current_setting('app.current_tenant_id', true))::uuid);
