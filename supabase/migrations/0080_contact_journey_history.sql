-- Jornada do paciente/cliente: log append-only por contato, separado do
-- estado atual (appointments/crm_lead_state continuam sendo overwrite-only,
-- intocados). Mesmo padrão de escalation_audit_events (0042): nunca
-- atualizado/apagado, só inserido, indexado por (tenant_id, phone, created_at
-- desc) pra alimentar uma timeline paginada na Ficha do Contato.
--
-- Não há backfill: o log só passa a existir a partir de quando o código que
-- insere nele for implantado — agendamentos/mudanças de estágio anteriores
-- não aparecerão retroativamente (decisão registrada no plano da tarefa).

create table if not exists public.appointment_journey_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  phone text not null,
  event_type text not null check (event_type in
    ('created', 'rescheduled', 'cancelled', 'completed', 'no_show', 'payment_verified')),
  service_summary text,
  scheduled_start timestamptz,
  scheduled_end timestamptz,
  payment_status text,
  event_id text,
  actor text not null default 'system' check (actor in ('ai', 'operator', 'system')),
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists appointment_journey_events_contact_idx
  on public.appointment_journey_events (tenant_id, phone, created_at desc);

create table if not exists public.crm_lead_stage_history (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  phone text not null,
  from_stage text,
  to_stage text not null,
  changed_by text,
  created_at timestamptz not null default now()
);

create index if not exists crm_lead_stage_history_contact_idx
  on public.crm_lead_stage_history (tenant_id, phone, created_at desc);

alter table public.appointment_journey_events enable row level security;
alter table public.crm_lead_stage_history enable row level security;

-- O backend usa a chave de serviço. Mantém o padrão de isolamento por tenant
-- das tabelas existentes (ver escalation_audit_events, 0042), sem expor
-- leitura pública ou políticas permissivas.
