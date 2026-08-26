-- RLS efetivo no runtime multi-tenant.
--
-- Antes: as policies comparavam tenant_id com app.current_tenant_id, mas o
-- backend acessava o PostgREST usando a service key, que possui BYPASSRLS e
-- nunca define essa variável. O isolamento dependia apenas dos filtros no
-- código TypeScript.
--
-- Depois: rotas autenticadas e webhooks já resolvidos usam um cliente com a
-- chave pública e um JWT interno, curto e assinado no backend. A policy lê o
-- claim tenant_id com auth.jwt(), que o PostgREST disponibiliza em cada
-- requisição. A service key fica reservada a fluxos de plataforma explícitos.
--
-- Pré-requisito de deploy: configurar SUPABASE_PUBLISHABLE_KEY e
-- SUPABASE_JWT_SECRET no backend antes de publicar esta migration. O processo
-- de produção falha cedo sem as duas variáveis (server/config.ts).

create or replace function public.current_runtime_tenant_id()
returns uuid
language sql
stable
set search_path = pg_catalog
as $$
  select nullif(auth.jwt() ->> 'tenant_id', '')::uuid
$$;

comment on function public.current_runtime_tenant_id() is
  'Tenant do JWT interno de runtime. Usado pelas policies RLS tenant-scoped.';

-- O papel authenticated precisa alcançar as relações protegidas, mas o RLS
-- limita cada operação ao tenant do JWT. `anon` continua sem policy e sem
-- acesso às tabelas internas.
grant usage on schema public to authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;
alter default privileges for role postgres in schema public
  grant select, insert, update, delete on tables to authenticated;

-- Todas as tabelas com tenant_id usam a mesma proteção. A remoção das
-- policies existentes é intencional: as policies antigas dependem de
-- app.current_tenant_id e não podem coexistir como policies permissivas (OR)
-- com a nova policy JWT.
do $$
declare
  v_table text;
  v_policy text;
begin
  for v_table in
    select c.table_name
    from information_schema.columns c
    join information_schema.tables t
      on t.table_schema = c.table_schema
     and t.table_name = c.table_name
    where c.table_schema = 'public'
      and c.column_name = 'tenant_id'
      and t.table_type = 'BASE TABLE'
    order by c.table_name
  loop
    execute format('alter table public.%I enable row level security', v_table);
    execute format('alter table public.%I force row level security', v_table);

    for v_policy in
      select p.policyname
      from pg_policies p
      where p.schemaname = 'public'
        and p.tablename = v_table
    loop
      execute format('drop policy if exists %I on public.%I', v_policy, v_table);
    end loop;

    execute format(
      'create policy tenant_jwt_isolation on public.%I for all to authenticated using (tenant_id = (select public.current_runtime_tenant_id())) with check (tenant_id = (select public.current_runtime_tenant_id()))',
      v_table
    );
  end loop;
end
$$;

-- tenants é a única relação de domínio sem coluna tenant_id: o tenant do JWT
-- só pode ler sua própria linha. Operações administrativas continuam passando
-- pelo cliente de plataforma, fora do caminho de runtime restrito.
alter table public.tenants enable row level security;
alter table public.tenants force row level security;
drop policy if exists tenant_self on public.tenants;
drop policy if exists tenant_jwt_self on public.tenants;
create policy tenant_jwt_self
on public.tenants
for select
to authenticated
using (id = (select public.current_runtime_tenant_id()));
