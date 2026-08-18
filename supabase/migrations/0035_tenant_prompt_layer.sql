-- Pedido real do dono do produto (18/08/2026): a Camada 1 (regras
-- universais fixas do prompt, hoje uma única linha global editável só por
-- saas_admin em `global_prompt_layer`) passa a ser LEGÍVEL e, se o
-- administrador do tenant quiser, editável por tenant — cada modelo de
-- negócio tem peculiaridades que podem justificar ajustar essa camada, e
-- hoje o admin do tenant nem sabe que ela existe (risco real de duplicar ou
-- entrar em conflito com uma regra que já está coberta ali).
--
-- Ausência de linha pra um tenant = ele ainda HERDA a Camada 1 global (ver
-- server/services/tenantPromptLayerStore.ts, resolveEffectiveGlobalLayer).
-- Assim que o tenant edita, ganha sua própria linha aqui e nunca mais herda
-- mudança futura da global automaticamente (decisão explícita do dono do
-- produto — simples e previsível, evita sobrescrever uma customização sem
-- avisar).
--
-- Como aplicar: via Supabase MCP `apply_migration` (ver CLAUDE.md — colar no
-- SQL Editor manualmente não fica registrado no histórico de migrations do
-- Supabase, causou incidente real antes, issue #93).

create table if not exists public.tenant_prompt_layer (
  tenant_id uuid primary key references public.tenants(id) on delete cascade,
  content text not null,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.operators(id)
);

drop trigger if exists update_tenant_prompt_layer_updated_at on public.tenant_prompt_layer;
create trigger update_tenant_prompt_layer_updated_at
  before update on public.tenant_prompt_layer
  for each row
  execute function public.update_updated_at_column();

-- Row Level Security — mesmo padrão do resto do schema (policy otimizada,
-- ver nota na migration 0011 sobre a issue #91).
alter table public.tenant_prompt_layer enable row level security;
alter table public.tenant_prompt_layer force row level security;
drop policy if exists tenant_isolation on public.tenant_prompt_layer;
create policy tenant_isolation on public.tenant_prompt_layer
  using (tenant_id = (select current_setting('app.current_tenant_id', true))::uuid)
  with check (tenant_id = (select current_setting('app.current_tenant_id', true))::uuid);
