-- Governança de escalonamentos, Ficha Inteligente persistida e eventos operacionais.
-- Migração aditiva: preserva linhas existentes e não remove colunas ou dados.

alter table public.escalations
  add column if not exists status text not null default 'open',
  add column if not exists priority text not null default 'medium',
  add column if not exists due_at timestamptz,
  add column if not exists assigned_operator_id uuid references public.operators(id) on delete set null,
  add column if not exists assigned_at timestamptz,
  add column if not exists resolved_at timestamptz,
  add column if not exists resolved_by uuid references public.operators(id) on delete set null,
  add column if not exists resolution_code text,
  add column if not exists resolution_note text,
  add column if not exists source_key text,
  add column if not exists occurrence_count integer not null default 1,
  add column if not exists guidance_expires_at timestamptz,
  add column if not exists guidance_context_hash text,
  add column if not exists last_alert_attempt_at timestamptz,
  add column if not exists last_alert_status text,
  add column if not exists deleted_at timestamptz;

update public.escalations
set source_key = concat('legacy:', id)
where source_key is null;

alter table public.escalations
  alter column source_key set not null;

update public.escalations
set status = case when resolved then 'resolved' else 'open' end
where status not in ('open', 'assigned', 'awaiting_customer', 'resolved', 'archived');

alter table public.escalations
  drop constraint if exists escalations_status_check,
  add constraint escalations_status_check check (status in ('open', 'assigned', 'awaiting_customer', 'resolved', 'archived')),
  drop constraint if exists escalations_priority_check,
  add constraint escalations_priority_check check (priority in ('critical', 'high', 'medium', 'low')),
  drop constraint if exists escalations_kind_check,
  add constraint escalations_kind_check check (kind in ('general', 'payment_proof', 'owner_review', 'customer_reply'));

create unique index if not exists escalations_tenant_source_key_unique
  on public.escalations (tenant_id, source_key);

create index if not exists escalations_open_priority_due_idx
  on public.escalations (tenant_id, status, priority, due_at, created_at desc)
  where deleted_at is null;

create index if not exists escalations_assigned_operator_idx
  on public.escalations (assigned_operator_id, status)
  where assigned_operator_id is not null and deleted_at is null;

create table if not exists public.escalation_audit_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  escalation_id text not null references public.escalations(id) on delete cascade,
  actor_id uuid references public.operators(id) on delete set null,
  event_type text not null,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists escalation_audit_events_lookup_idx
  on public.escalation_audit_events (tenant_id, escalation_id, created_at desc);

create table if not exists public.conversation_analyses (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  phone text not null,
  context_hash text not null,
  message_count integer not null,
  source text not null,
  model text,
  analysis jsonb not null,
  generated_at timestamptz not null default now(),
  superseded_at timestamptz,
  created_by uuid references public.operators(id) on delete set null,
  unique (tenant_id, phone, context_hash)
);

create index if not exists conversation_analyses_latest_idx
  on public.conversation_analyses (tenant_id, phone, generated_at desc);

create table if not exists public.operation_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  phone text,
  escalation_id text references public.escalations(id) on delete set null,
  event_type text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists operation_events_tenant_created_idx
  on public.operation_events (tenant_id, created_at desc);

alter table public.escalation_audit_events enable row level security;
alter table public.conversation_analyses enable row level security;
alter table public.operation_events enable row level security;

-- O backend usa a chave de serviço. Mantém o padrão de isolamento por tenant
-- das tabelas existentes, sem expor leitura pública ou políticas permissivas.
