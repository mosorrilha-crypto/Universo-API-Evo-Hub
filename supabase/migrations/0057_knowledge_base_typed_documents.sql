-- TASK-0101 / issue #96 — Base de Conhecimento em documentos tipados.
--
-- Esta migration NÃO troca a leitura do runtime: o agente continua usando
-- knowledge_base.data até o corte explicitamente validado. Ela cria a base
-- versionada, migra os valores existentes para published v1 e mantém o blob
-- legado intacto como rollback e fonte de equivalência.

create table if not exists public.knowledge_base_documents (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  document_type text not null check (document_type in (
    'business_profile',
    'brand_voice',
    'service_catalog',
    'pricing_policies',
    'opening_hours',
    'faq',
    'human_handoff_rules',
    'media_assets'
  )),
  version integer not null check (version >= 1),
  status text not null check (status in ('draft', 'published')),
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  created_by uuid references public.operators(id) on delete set null,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.operators(id) on delete set null,
  published_at timestamptz,
  published_by uuid references public.operators(id) on delete set null
);

-- Garante uma sequência de versões por tipo e evita que rascunhos duplicados
-- façam duas abas concorrerem silenciosamente pelo próximo conteúdo.
create unique index if not exists knowledge_base_documents_version_unique
  on public.knowledge_base_documents (tenant_id, document_type, version);

create unique index if not exists knowledge_base_documents_one_draft_per_type
  on public.knowledge_base_documents (tenant_id, document_type)
  where status = 'draft';

-- Invariante crítica da publicação: duas requisições concorrentes nunca podem
-- deixar duas versões publicadas para o mesmo tenant e tipo.
create unique index if not exists knowledge_base_documents_one_published_per_type
  on public.knowledge_base_documents (tenant_id, document_type)
  where status = 'published';

create index if not exists knowledge_base_documents_tenant_type_status_idx
  on public.knowledge_base_documents (tenant_id, document_type, status);

create table if not exists public.knowledge_base_document_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  document_id uuid not null references public.knowledge_base_documents(id) on delete cascade,
  document_type text not null check (document_type in (
    'business_profile',
    'brand_voice',
    'service_catalog',
    'pricing_policies',
    'opening_hours',
    'faq',
    'human_handoff_rules',
    'media_assets'
  )),
  version integer not null check (version >= 1),
  event_type text not null check (event_type in ('draft_created', 'draft_updated', 'published')),
  actor_id uuid references public.operators(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists knowledge_base_document_events_tenant_created_idx
  on public.knowledge_base_document_events (tenant_id, created_at desc);

-- O backfill não infere nem reescreve dados. Campos que não possuem uma fonte
-- estruturada no blob atual são publicados como objeto vazio; o blob legado
-- continua preservado para rollback e comparação até o corte de runtime.
with legacy_documents as (
  select
    kb.tenant_id,
    item.document_type,
    item.data
  from public.knowledge_base kb
  cross join lateral (
    values
      ('business_profile'::text, jsonb_strip_nulls(jsonb_build_object(
        'companyName', kb.data -> 'companyName',
        'agentGoal', kb.data -> 'agentGoal',
        'businessModel', kb.data -> 'businessModel',
        'locationMapsUrl', kb.data -> 'locationMapsUrl'
      ))),
      ('brand_voice'::text, jsonb_strip_nulls(jsonb_build_object(
        'toneOfVoice', kb.data -> 'toneOfVoice'
      ))),
      ('service_catalog'::text, jsonb_strip_nulls(jsonb_build_object(
        'products', kb.data -> 'products'
      ))),
      ('pricing_policies'::text, jsonb_strip_nulls(jsonb_build_object(
        'pricingAndPolicies', kb.data -> 'pricingAndPolicies',
        'businessRules', kb.data -> 'businessRules'
      ))),
      ('opening_hours'::text, '{}'::jsonb),
      ('faq'::text, jsonb_strip_nulls(jsonb_build_object(
        'faqs', kb.data -> 'faqs'
      ))),
      ('human_handoff_rules'::text, '{}'::jsonb),
      ('media_assets'::text, jsonb_strip_nulls(jsonb_build_object(
        'documents', kb.data -> 'documents',
        'firstContactBlocks', kb.data -> 'firstContactBlocks'
      )))
  ) as item(document_type, data)
)
insert into public.knowledge_base_documents (
  tenant_id,
  document_type,
  version,
  status,
  data,
  published_at
)
select
  legacy.tenant_id,
  legacy.document_type,
  1,
  'published',
  legacy.data,
  now()
from legacy_documents legacy
where not exists (
  select 1
  from public.knowledge_base_documents existing
  where existing.tenant_id = legacy.tenant_id
    and existing.document_type = legacy.document_type
    and existing.status = 'published'
);

insert into public.knowledge_base_document_events (
  tenant_id,
  document_id,
  document_type,
  version,
  event_type
)
select
  document.tenant_id,
  document.id,
  document.document_type,
  document.version,
  'published'
from public.knowledge_base_documents document
where document.version = 1
  and document.status = 'published'
  and not exists (
    select 1
    from public.knowledge_base_document_events event
    where event.document_id = document.id
      and event.event_type = 'published'
  );

grant select, insert, update, delete on public.knowledge_base_documents to authenticated;
grant select, insert, update, delete on public.knowledge_base_document_events to authenticated;

alter table public.knowledge_base_documents enable row level security;
alter table public.knowledge_base_documents force row level security;
drop policy if exists tenant_jwt_isolation on public.knowledge_base_documents;
create policy tenant_jwt_isolation on public.knowledge_base_documents
  for all to authenticated
  using (tenant_id = (select public.current_runtime_tenant_id()))
  with check (tenant_id = (select public.current_runtime_tenant_id()));

alter table public.knowledge_base_document_events enable row level security;
alter table public.knowledge_base_document_events force row level security;
drop policy if exists tenant_jwt_isolation on public.knowledge_base_document_events;
create policy tenant_jwt_isolation on public.knowledge_base_document_events
  for all to authenticated
  using (tenant_id = (select public.current_runtime_tenant_id()))
  with check (tenant_id = (select public.current_runtime_tenant_id()));

comment on table public.knowledge_base_documents is
  'Documentos tipados, versionados e publicáveis da Base de Conhecimento por tenant. O blob knowledge_base.data permanece como rollback durante a transição.';
comment on table public.knowledge_base_document_events is
  'Trilha de auditoria de criação, atualização e publicação dos documentos tipados da Base de Conhecimento.';
