-- Central de Qualidade e Aprendizado Supervisionado.
-- As tabelas são tenant-scoped; nenhuma decisão de um cliente deve alimentar
-- automaticamente o comportamento de outro cliente.

create table if not exists public.quality_reviews (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  kind text not null check (kind in ('ai_suggestion', 'bug', 'operator_idea', 'knowledge')),
  status text not null default 'pending' check (status in ('pending', 'approved', 'testing', 'published', 'rejected', 'resolved', 'reopened')),
  title text not null,
  description text not null,
  context jsonb not null default '{}'::jsonb,
  confidence numeric(5,4),
  original_value text,
  corrected_value text,
  created_by uuid references public.operators(id) on delete set null,
  reviewed_by uuid references public.operators(id) on delete set null,
  review_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.quality_reviews
  add column if not exists updated_at timestamptz not null default now();

create index if not exists quality_reviews_tenant_status_created_idx
  on public.quality_reviews (tenant_id, status, created_at desc);

create index if not exists quality_reviews_tenant_kind_created_idx
  on public.quality_reviews (tenant_id, kind, created_at desc);

create table if not exists public.quality_audit_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  event_type text not null,
  source text not null,
  entity_type text,
  entity_id text,
  conversation_phone text,
  actor_id uuid references public.operators(id) on delete set null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists quality_audit_events_tenant_created_idx
  on public.quality_audit_events (tenant_id, created_at desc);

create index if not exists quality_audit_events_tenant_entity_idx
  on public.quality_audit_events (tenant_id, entity_type, entity_id);

alter table public.quality_reviews enable row level security;
alter table public.quality_audit_events enable row level security;

-- O backend usa a service key e faz o isolamento explicitamente por tenantId.
-- Estas policies protegem acessos futuros com a chave anon/authenticated e não
-- substituem a validação do backend.
drop policy if exists quality_reviews_tenant_access on public.quality_reviews;
create policy quality_reviews_tenant_access on public.quality_reviews
  for all using (tenant_id = (select current_setting('app.current_tenant_id', true))::uuid)
  with check (tenant_id = (select current_setting('app.current_tenant_id', true))::uuid);

drop policy if exists quality_audit_events_tenant_access on public.quality_audit_events;
create policy quality_audit_events_tenant_access on public.quality_audit_events
  for all using (tenant_id = (select current_setting('app.current_tenant_id', true))::uuid)
  with check (tenant_id = (select current_setting('app.current_tenant_id', true))::uuid);
