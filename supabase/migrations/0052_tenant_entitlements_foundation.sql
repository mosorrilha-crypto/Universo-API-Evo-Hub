-- TASK-0086 — Fundação de entitlements por tenant.
--
-- Separa definitivamente modelo de negócio (contexto operacional), plano
-- comercial, direito efetivo, uso e RBAC. Nenhuma regra desta migration amplia
-- privilégios, desativa RLS ou usa `tenants.segment` como autorização.
--
-- Aplicar pelo Supabase MCP `apply_migration` antes do deploy do código que
-- consome estas tabelas. O seed de compatibilidade mantém TODOS os tenants
-- existentes com o conjunto atual de funcionalidades habilitado.

-- ── Catálogo global de produto (somente plataforma) ──────────────────────
create table if not exists public.business_models (
  id uuid primary key default gen_random_uuid(),
  key text not null unique,
  name text not null,
  status text not null default 'active' check (status in ('active', 'archived')),
  default_config jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.features (
  id uuid primary key default gen_random_uuid(),
  key text not null unique,
  name text not null,
  domain text not null,
  kind text not null default 'boolean' check (kind in ('boolean', 'quota', 'configurable')),
  config_schema jsonb not null default '{}'::jsonb,
  status text not null default 'active' check (status in ('active', 'retired')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.plans (
  id uuid primary key default gen_random_uuid(),
  key text not null,
  name text not null,
  version integer not null default 1 check (version > 0),
  business_model_id uuid references public.business_models(id) on delete set null,
  status text not null default 'active' check (status in ('draft', 'active', 'archived')),
  description text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (key, version)
);

create table if not exists public.plan_feature_rules (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.plans(id) on delete cascade,
  feature_id uuid not null references public.features(id) on delete restrict,
  enabled boolean not null default true,
  limit_value integer check (limit_value is null or limit_value >= 0),
  config jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (plan_id, feature_id)
);

-- ── Relações comerciais e decisão por tenant ─────────────────────────────
alter table public.tenants
  add column if not exists business_model_id uuid references public.business_models(id) on delete set null;

create table if not exists public.tenant_subscriptions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  plan_id uuid not null references public.plans(id) on delete restrict,
  status text not null default 'active' check (status in ('trial', 'active', 'paused', 'cancelled')),
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  assigned_by text,
  reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ended_at is null or ended_at >= started_at)
);
create index if not exists tenant_subscriptions_tenant_status_idx
  on public.tenant_subscriptions (tenant_id, status, started_at desc);
create unique index if not exists tenant_subscriptions_one_current_idx
  on public.tenant_subscriptions (tenant_id)
  where status in ('trial', 'active') and ended_at is null;

create table if not exists public.tenant_feature_overrides (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  feature_id uuid not null references public.features(id) on delete restrict,
  -- null significa "herdar do plano"; o override pode alterar só limite/config.
  enabled boolean,
  limit_value integer check (limit_value is null or limit_value >= 0),
  config jsonb not null default '{}'::jsonb,
  reason text not null check (length(trim(reason)) > 0),
  expires_at timestamptz,
  revoked_at timestamptz,
  revoked_by text,
  created_by text,
  request_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (expires_at is null or expires_at > created_at)
);
create index if not exists tenant_feature_overrides_effective_idx
  on public.tenant_feature_overrides (tenant_id, feature_id, created_at desc)
  where revoked_at is null;

create table if not exists public.tenant_feature_usage (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  feature_id uuid not null references public.features(id) on delete restrict,
  metric text not null,
  period_start date not null,
  value integer not null default 0 check (value >= 0),
  updated_at timestamptz not null default now(),
  unique (tenant_id, feature_id, metric, period_start)
);

create table if not exists public.tenant_entitlement_audit (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  feature_id uuid references public.features(id) on delete set null,
  action text not null check (action in ('subscription_changed', 'override_created', 'override_revoked', 'usage_adjusted')),
  before_state jsonb,
  after_state jsonb,
  actor_id text,
  reason text,
  request_id text,
  created_at timestamptz not null default now()
);
create index if not exists tenant_entitlement_audit_tenant_created_idx
  on public.tenant_entitlement_audit (tenant_id, created_at desc);

-- ── RLS: globais negadas à API; relações do tenant presas ao JWT ─────────
revoke all privileges on table public.business_models from anon, authenticated;
revoke all privileges on table public.features from anon, authenticated;
revoke all privileges on table public.plans from anon, authenticated;
revoke all privileges on table public.plan_feature_rules from anon, authenticated;

DO $$
declare
  v_table text;
begin
  foreach v_table in array array['business_models', 'features', 'plans', 'plan_feature_rules']
  loop
    execute format('alter table public.%I enable row level security', v_table);
    execute format('alter table public.%I force row level security', v_table);
    execute format('drop policy if exists platform_only_deny_api on public.%I', v_table);
    execute format('create policy platform_only_deny_api on public.%I as restrictive for all to anon, authenticated using (false) with check (false)', v_table);
  end loop;
end
$$;

DO $$
declare
  v_table text;
begin
  foreach v_table in array array['tenant_subscriptions', 'tenant_feature_overrides', 'tenant_feature_usage', 'tenant_entitlement_audit']
  loop
    execute format('alter table public.%I enable row level security', v_table);
    execute format('alter table public.%I force row level security', v_table);
    execute format('drop policy if exists tenant_jwt_isolation on public.%I', v_table);
    execute format('create policy tenant_jwt_isolation on public.%I for all to authenticated using (tenant_id = (select public.current_runtime_tenant_id())) with check (tenant_id = (select public.current_runtime_tenant_id()))', v_table);
  end loop;
end
$$;

-- ── Catálogo mínimo e plano de compatibilidade ───────────────────────────
insert into public.business_models (key, name, status, default_config)
values ('generic', 'Genérico', 'active', '{}'::jsonb)
on conflict (key) do nothing;

insert into public.features (key, name, domain, kind, status)
values
  ('inbox.conversations', 'Conversas', 'inbox', 'boolean', 'active'),
  ('ai.auto_reply', 'Agente de IA', 'ai', 'quota', 'active'),
  ('booking.calendar', 'Agenda', 'booking', 'configurable', 'active'),
  ('booking.reminders', 'Lembretes de agendamento', 'booking', 'quota', 'active'),
  ('crm.follow_ups', 'Acompanhamento de CRM', 'crm', 'quota', 'active'),
  ('sales.financial', 'Financeiro', 'sales', 'boolean', 'active'),
  ('catalog.public_page', 'Catálogo público', 'catalog', 'configurable', 'active'),
  ('growth.meta_ads', 'Crescimento e Meta Ads', 'growth', 'configurable', 'active'),
  ('channel.meta_whatsapp', 'Canal Meta WhatsApp', 'channel', 'configurable', 'active'),
  ('channel.evolution', 'Canal Evolution', 'channel', 'configurable', 'active'),
  ('channel.instagram', 'Canal Instagram', 'channel', 'configurable', 'active'),
  ('quality.agent_review', 'Qualidade do agente', 'quality', 'configurable', 'active'),
  ('admin.tenant_operators', 'Operadores do tenant', 'admin', 'quota', 'active')
on conflict (key) do update set name = excluded.name, domain = excluded.domain, kind = excluded.kind, status = excluded.status;

insert into public.plans (key, name, version, business_model_id, status, description)
select 'compatibility', 'Compatibilidade integral', 1, bm.id, 'active', 'Plano interno que preserva as capacidades vigentes durante a transição para entitlements.'
from public.business_models bm
where bm.key = 'generic'
on conflict (key, version) do nothing;

insert into public.plan_feature_rules (plan_id, feature_id, enabled, limit_value, config)
select p.id, f.id, true,
  case f.key
    when 'ai.auto_reply' then 100000
    when 'booking.reminders' then 100000
    when 'crm.follow_ups' then 100000
    when 'admin.tenant_operators' then 1000
    else null
  end,
  '{}'::jsonb
from public.plans p
join public.features f on f.status = 'active'
where p.key = 'compatibility' and p.version = 1
on conflict (plan_id, feature_id) do nothing;

-- Migra todos os tenants existentes para o plano compatível sem retirar acesso.
insert into public.tenant_subscriptions (tenant_id, plan_id, status, started_at, assigned_by, reason)
select t.id, p.id, 'active', now(), 'migration:0052', 'Plano de compatibilidade criado na fundação de entitlements.'
from public.tenants t
join public.plans p on p.key = 'compatibility' and p.version = 1
where not exists (
  select 1 from public.tenant_subscriptions s
  where s.tenant_id = t.id and s.status in ('trial', 'active') and s.ended_at is null
);

-- Registro de auditoria da migração, sem suprimir a origem da decisão.
insert into public.tenant_entitlement_audit (tenant_id, action, after_state, actor_id, reason)
select s.tenant_id, 'subscription_changed', jsonb_build_object('plan_key', p.key, 'plan_version', p.version, 'status', s.status), 'migration:0052', s.reason
from public.tenant_subscriptions s
join public.plans p on p.id = s.plan_id
where s.assigned_by = 'migration:0052'
  and not exists (
    select 1 from public.tenant_entitlement_audit a
    where a.tenant_id = s.tenant_id and a.action = 'subscription_changed' and a.actor_id = 'migration:0052'
  );
