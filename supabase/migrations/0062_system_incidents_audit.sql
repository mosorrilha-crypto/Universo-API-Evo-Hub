-- Logs do Sistema: incidentes técnicos auditáveis por tenant.
-- Não dispara notificações; a revisão é feita no painel administrativo.

create table if not exists public.system_incidents (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  source_key text not null,
  category text not null check (category in ('runtime', 'knowledge_base', 'authentication', 'catalog', 'media', 'integration', 'availability')),
  severity text not null check (severity in ('critical', 'high', 'medium', 'low')),
  status text not null default 'open' check (status in ('open', 'reviewed', 'resolved', 'archived')),
  title text not null,
  detail text not null default '',
  suggested_action text not null,
  metadata jsonb not null default '{}'::jsonb,
  occurrence_count integer not null default 1 check (occurrence_count > 0),
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by uuid references public.operators(id) on delete set null,
  resolved_at timestamptz,
  resolved_by uuid references public.operators(id) on delete set null,
  resolution_note text
);

create unique index if not exists system_incidents_active_source_key_idx
  on public.system_incidents (tenant_id, source_key)
  where status in ('open', 'reviewed');

create index if not exists system_incidents_tenant_status_last_seen_idx
  on public.system_incidents (tenant_id, status, last_seen_at desc);

create index if not exists system_incidents_tenant_severity_last_seen_idx
  on public.system_incidents (tenant_id, severity, last_seen_at desc);

create table if not exists public.system_incident_audit_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  incident_id uuid not null references public.system_incidents(id) on delete cascade,
  actor_id uuid references public.operators(id) on delete set null,
  event_type text not null check (event_type in ('created', 'recurred', 'reviewed', 'resolved', 'archived', 'restored')),
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists system_incident_audit_events_lookup_idx
  on public.system_incident_audit_events (tenant_id, incident_id, created_at desc);

alter table public.system_incidents enable row level security;
alter table public.system_incidents force row level security;
alter table public.system_incident_audit_events enable row level security;
alter table public.system_incident_audit_events force row level security;

drop policy if exists tenant_jwt_isolation on public.system_incidents;
create policy tenant_jwt_isolation on public.system_incidents
  for all to authenticated
  using (tenant_id = (select public.current_runtime_tenant_id()))
  with check (tenant_id = (select public.current_runtime_tenant_id()));

drop policy if exists tenant_jwt_isolation on public.system_incident_audit_events;
create policy tenant_jwt_isolation on public.system_incident_audit_events
  for all to authenticated
  using (tenant_id = (select public.current_runtime_tenant_id()))
  with check (tenant_id = (select public.current_runtime_tenant_id()));

comment on table public.system_incidents is 'Incidentes técnicos auditáveis do agente por tenant; sem notificações automáticas.';
comment on table public.system_incident_audit_events is 'Trilha de revisão humana e resolução de incidentes técnicos por tenant.';
