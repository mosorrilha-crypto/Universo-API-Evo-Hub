-- Instagram DM (Fase 1, pedido real 15/08/2026 — "como responder lead do
-- Instagram") — mesma estrutura de `tenant_evolution_credentials` (migration
-- 0011): uma credencial por tenant, chave de roteamento do webhook de
-- entrada é o ID da conta Instagram (equivalente ao instance_name/
-- phone_number_id dos outros dois provedores já suportados).
--
-- Como aplicar: via Supabase MCP `apply_migration` (ver CLAUDE.md — colar no
-- SQL Editor manualmente não fica registrado no histórico de migrations do
-- Supabase, causou incidente real antes, issue #93).

create table if not exists public.tenant_instagram_credentials (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  -- ID da conta profissional do Instagram (IGSID da própria conta) — chave
  -- usada tanto pra rotear o webhook de entrada (qual tenant é dono dessa
  -- conta) quanto pra montar as chamadas de envio (/{instagram_account_id}/messages).
  instagram_account_id text not null unique,
  access_token text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id)
);
create index if not exists tenant_instagram_credentials_account_idx
  on public.tenant_instagram_credentials (instagram_account_id);

drop trigger if exists update_tenant_instagram_credentials_updated_at on public.tenant_instagram_credentials;
create trigger update_tenant_instagram_credentials_updated_at
  before update on public.tenant_instagram_credentials
  for each row
  execute function public.update_updated_at_column();

-- Row Level Security — mesmo padrão do resto do schema (policy otimizada,
-- ver nota na migration 0011 sobre a issue #91).
alter table public.tenant_instagram_credentials enable row level security;
alter table public.tenant_instagram_credentials force row level security;
drop policy if exists tenant_isolation on public.tenant_instagram_credentials;
create policy tenant_isolation on public.tenant_instagram_credentials
  using (tenant_id = (select current_setting('app.current_tenant_id', true))::uuid)
  with check (tenant_id = (select current_setting('app.current_tenant_id', true))::uuid);
