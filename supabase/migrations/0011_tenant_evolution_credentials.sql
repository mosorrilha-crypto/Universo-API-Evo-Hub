-- Epic 4.6 (Evolution API multi-instância) — mesma estrutura de
-- `tenant_meta_credentials` (migration 0001), mas para a "Porta A" de
-- entrada (QR Code / Evolution API self-hosted, sem exigir Business
-- Manager verificado pela Meta). Uma instância Evolution por tenant, em vez
-- da única instância global fixa (EVOLUTION_API_URL/API_KEY/INSTANCE_NAME)
-- usada até aqui.
--
-- Como aplicar: cole este arquivo no SQL Editor do painel Supabase do
-- projeto e rode uma vez. Idempotente, seguro rodar de novo.

create table if not exists public.tenant_evolution_credentials (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  -- Nome da instância na Evolution API — chave usada tanto pra rotear o
  -- webhook de entrada (qual tenant é dono dessa instância) quanto pra
  -- montar as chamadas de envio (/message/sendText/{instance}).
  instance_name text not null unique,
  api_url text not null,
  api_key text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id)
);
create index if not exists tenant_evolution_credentials_instance_idx
  on public.tenant_evolution_credentials (instance_name);

create or replace function public.update_updated_at_column()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists update_tenant_evolution_credentials_updated_at on public.tenant_evolution_credentials;
create trigger update_tenant_evolution_credentials_updated_at
  before update on public.tenant_evolution_credentials
  for each row
  execute function public.update_updated_at_column();

-- Row Level Security — mesmo padrão do resto do schema (ver nota na
-- migration 0001 sobre a service key ainda bypassar RLS).
alter table public.tenant_evolution_credentials enable row level security;
alter table public.tenant_evolution_credentials force row level security;
drop policy if exists tenant_isolation on public.tenant_evolution_credentials;
create policy tenant_isolation on public.tenant_evolution_credentials
  using (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  with check (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
