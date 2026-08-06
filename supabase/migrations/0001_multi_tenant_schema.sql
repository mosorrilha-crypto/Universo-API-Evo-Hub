-- Bloco 2.A — Schema de tenant e persistência real
-- Substitui os 8 serviços que hoje guardam estado em Map/variável global +
-- 1 JSON no Supabase Storage por tabelas Postgres reais, particionadas por
-- tenant_id, com Row Level Security.
--
-- Como aplicar: cole este arquivo no SQL Editor do painel Supabase do
-- projeto (Project > SQL Editor > New query) e rode uma vez. Idempotente
-- (usa IF NOT EXISTS / ON CONFLICT em todo lugar), seguro rodar de novo.
--
-- Nota sobre RLS: as políticas abaixo usam current_setting('app.current_tenant_id'),
-- uma variável de sessão que o backend precisa definir por requisição pra
-- RLS realmente barrar. Hoje o backend fala com o Postgres através da
-- service key do Supabase (via supabase-js/PostgREST), que tem o atributo
-- BYPASSRLS por padrão — ou seja, essas políticas ficam prontas e corretas,
-- mas não são a barreira ativa enquanto o backend usar a service key. A
-- barreira ativa hoje é o parâmetro tenantId obrigatório em cada função de
-- serviço (server/services/*.ts). Ligar a política de verdade end-to-end
-- exige trocar pra uma role Postgres restrita (sem BYPASSRLS) com conexão
-- direta — item de follow-up, não bloqueia este bloco.

create extension if not exists pgcrypto;

-- ── tenants ────────────────────────────────────────────────────────────
create table if not exists public.tenants (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text unique,
  currency text not null default 'PYG',
  locale text not null default 'es-PY',
  created_at timestamptz not null default now()
);

-- ── operators (login real por operador, substitui os 4 usuários demo) ──
create table if not exists public.operators (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  email text not null,
  password_hash text not null,
  name text not null,
  role text not null check (role in ('operator', 'manager', 'admin', 'saas_admin')),
  created_at timestamptz not null default now(),
  unique (tenant_id, email)
);

-- ── credenciais Meta (WABA/phone_number_id/token) por tenant ───────────
create table if not exists public.tenant_meta_credentials (
  tenant_id uuid primary key references public.tenants(id) on delete cascade,
  phone_number_id text unique,
  waba_id text,
  access_token text,
  mode text not null default 'shared' check (mode in ('shared', 'byo')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ── token do Google Calendar por tenant ─────────────────────────────────
create table if not exists public.tenant_calendar_tokens (
  tenant_id uuid primary key references public.tenants(id) on delete cascade,
  refresh_token text not null,
  google_account_email text,
  connected_at timestamptz not null default now()
);

-- ── conversas + mensagens (server/services/conversationStore.ts) ───────
create table if not exists public.conversations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  phone text not null,
  name text,
  geo_restriction jsonb,
  updated_at timestamptz not null default now(),
  unique (tenant_id, phone)
);
create index if not exists conversations_tenant_updated_idx on public.conversations (tenant_id, updated_at desc);

create table if not exists public.messages (
  id text primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  sender text not null check (sender in ('lead', 'agent')),
  type text not null check (type in ('text', 'audio', 'image', 'file')),
  text text,
  created_at timestamptz not null default now()
);
create index if not exists messages_conversation_idx on public.messages (tenant_id, conversation_id, created_at);

-- ── base de conhecimento (1 registro por tenant, mesmo formato JSON) ───
create table if not exists public.knowledge_base (
  tenant_id uuid primary key references public.tenants(id) on delete cascade,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

-- ── escalonamentos pra atendimento humano ───────────────────────────────
create table if not exists public.escalations (
  id text primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  phone text not null,
  contact_name text,
  reason text not null,
  last_message text,
  country text,
  resolved boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists escalations_tenant_idx on public.escalations (tenant_id, resolved, created_at desc);

-- ── respostas rápidas (1 registro por tenant, lista JSON) ───────────────
create table if not exists public.quick_replies (
  tenant_id uuid primary key references public.tenants(id) on delete cascade,
  list jsonb not null default '[]'::jsonb
);

-- ── status do agente automático (1 registro por tenant) ────────────────
create table if not exists public.agent_status (
  tenant_id uuid primary key references public.tenants(id) on delete cascade,
  status text not null default 'active' check (status in ('active', 'paused', 'restricted')),
  updated_at timestamptz not null default now()
);

-- ── agendamento ativo por telefone (server/services/appointmentStore.ts) ─
create table if not exists public.appointments (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  phone text not null,
  event_id text not null,
  summary text not null,
  start_iso text not null,
  end_iso text not null,
  created_at timestamptz not null default now(),
  primary key (tenant_id, phone)
);
create index if not exists appointments_event_idx on public.appointments (tenant_id, event_id);

-- ── controle de lembretes já enviados ───────────────────────────────────
create table if not exists public.sent_reminders (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  event_id text not null,
  reminder_type text not null check (reminder_type in ('dia_anterior', 'mesmo_dia')),
  sent_at timestamptz not null default now(),
  primary key (tenant_id, event_id, reminder_type)
);

-- ── Row Level Security ───────────────────────────────────────────────────
do $$
declare
  t text;
begin
  for t in select unnest(array[
    'operators', 'tenant_meta_credentials', 'tenant_calendar_tokens',
    'conversations', 'messages', 'knowledge_base', 'escalations',
    'quick_replies', 'agent_status', 'appointments', 'sent_reminders'
  ])
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
    execute format('drop policy if exists tenant_isolation on public.%I', t);
    execute format(
      'create policy tenant_isolation on public.%I using (tenant_id = current_setting(''app.current_tenant_id'', true)::uuid) with check (tenant_id = current_setting(''app.current_tenant_id'', true)::uuid)',
      t
    );
  end loop;
end $$;

-- tenants: sem tenant_id próprio (é a própria linha) — cada operador só
-- enxerga a linha do seu tenant. saas_admin (que enxerga tudo) segue sem
-- RLS aqui de propósito: essa exceção é tratada na camada de aplicação
-- (RBAC do Bloco 2.D), não faz sentido modelar em RLS de tenant único.
alter table public.tenants enable row level security;
drop policy if exists tenant_self on public.tenants;
create policy tenant_self on public.tenants
  using (id = current_setting('app.current_tenant_id', true)::uuid);

-- ── Seed: tenant legado da Monique, dono de todo o dado atual em produção ─
-- UUID fixo de propósito (não gen_random_uuid()) — o código do backend
-- referencia essa constante em server/services/tenantContext.ts como ponte
-- até o roteamento multi-tenant real (Bloco 2.B) resolver o tenant por
-- phone_number_id em vez de usar um valor fixo.
insert into public.tenants (id, name, slug, currency, locale)
values ('11111111-1111-1111-1111-111111111111', 'Monique — Pestañas por Monique', 'monique', 'PYG', 'es-PY')
on conflict (id) do nothing;
