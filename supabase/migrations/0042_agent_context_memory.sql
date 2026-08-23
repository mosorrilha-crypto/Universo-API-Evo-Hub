-- Primeira camada de engenharia de contexto do agente WhatsApp.
--
-- `contact_agent_memory` guarda somente memória operacional compacta por
-- contato/tenant. Não é fonte de verdade de agenda, pagamento ou escalonamento:
-- esses estados continuam em appointments/escalations e são consultados a cada
-- turno. `agent_turn_traces` registra decisões e resultados redigidos para
-- auditoria, sem prompts completos, textos de mensagens, mídia, comprovantes,
-- credenciais ou tokens.

create table if not exists public.contact_agent_memory (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  phone text not null,
  preferred_language text,
  preferred_name text,
  current_intent text,
  service_interest text,
  objections jsonb not null default '[]'::jsonb check (jsonb_typeof(objections) = 'array'),
  facts_confirmed jsonb not null default '{}'::jsonb check (jsonb_typeof(facts_confirmed) = 'object'),
  open_loops jsonb not null default '[]'::jsonb check (jsonb_typeof(open_loops) = 'array'),
  next_best_action text,
  conversation_summary text,
  updated_by text not null default 'system' check (updated_by in ('system', 'operator')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (tenant_id, phone)
);

create index if not exists contact_agent_memory_tenant_updated_idx
  on public.contact_agent_memory (tenant_id, updated_at desc);

create table if not exists public.agent_turn_traces (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  phone text not null,
  message_id text,
  router_decision text not null,
  router_confidence numeric(5,4),
  reasoning_summary text,
  context_pack_version text not null,
  selected_facts jsonb not null default '{}'::jsonb check (jsonb_typeof(selected_facts) = 'object'),
  tool_summaries jsonb not null default '[]'::jsonb check (jsonb_typeof(tool_summaries) = 'array'),
  needs_human_confirmation boolean not null default false,
  escalation_id text,
  provider text,
  model text,
  latency_ms integer check (latency_ms is null or latency_ms >= 0),
  estimated_cost_usd numeric(12,8) check (estimated_cost_usd is null or estimated_cost_usd >= 0),
  outcome text,
  created_at timestamptz not null default now(),
  unique (tenant_id, message_id)
);

create index if not exists agent_turn_traces_tenant_created_idx
  on public.agent_turn_traces (tenant_id, created_at desc);

create index if not exists agent_turn_traces_tenant_phone_created_idx
  on public.agent_turn_traces (tenant_id, phone, created_at desc);

alter table public.contact_agent_memory enable row level security;
alter table public.agent_turn_traces enable row level security;

-- O backend atual usa a service key e filtra tenant_id em toda operação.
-- As policies abaixo reforçam futuros acessos anon/authenticated e não
-- substituem a checagem explícita da camada de serviço.
drop policy if exists contact_agent_memory_tenant_access on public.contact_agent_memory;
create policy contact_agent_memory_tenant_access on public.contact_agent_memory
  for all using (tenant_id = (select current_setting('app.current_tenant_id', true))::uuid)
  with check (tenant_id = (select current_setting('app.current_tenant_id', true))::uuid);

drop policy if exists agent_turn_traces_tenant_access on public.agent_turn_traces;
create policy agent_turn_traces_tenant_access on public.agent_turn_traces
  for all using (tenant_id = (select current_setting('app.current_tenant_id', true))::uuid)
  with check (tenant_id = (select current_setting('app.current_tenant_id', true))::uuid);
