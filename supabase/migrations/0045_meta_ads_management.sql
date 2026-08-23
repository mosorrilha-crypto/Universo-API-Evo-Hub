-- Central de Anúncios Meta — gerenciamento supervisionado por tenant.
-- O token de gerenciamento é separado do token usado apenas para métricas.
-- A tabela de operações impede repetir uma escrita externa com a mesma chave.

alter table public.tenant_meta_credentials
  add column if not exists meta_ads_management_access_token text;

comment on column public.tenant_meta_credentials.meta_ads_management_access_token is
  'Token server-side da Marketing API com ads_management e permissões de página necessárias. Nunca retornar ao frontend.';

create table if not exists public.meta_ads_operation_requests (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  idempotency_key text not null,
  operation text not null,
  resource_id text,
  status text not null default 'pending' check (status in ('pending', 'succeeded', 'failed')),
  response jsonb,
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists meta_ads_operation_requests_tenant_key_operation_idx
  on public.meta_ads_operation_requests (tenant_id, idempotency_key, operation);

create index if not exists meta_ads_operation_requests_tenant_created_idx
  on public.meta_ads_operation_requests (tenant_id, created_at desc);

alter table public.meta_ads_operation_requests enable row level security;

comment on table public.meta_ads_operation_requests is
  'Idempotência e resultado mínimo das operações de gerenciamento Meta. Não armazena tokens nem criativos completos.';
