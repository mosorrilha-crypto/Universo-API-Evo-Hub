-- [CRM] Conecta o OperatorCRM (Kanban) aos leads reais — hoje o painel é
-- 100% mock/localStorage (App.tsx só lê/grava saas_crm_leads), então leads
-- reais que já chegam em `conversations` nunca aparecem lá sozinhos, a menos
-- que um operador cadastre cada um manualmente.
--
-- Estado de CRM por lead (estágio do funil, valor do negócio, operador
-- responsável, notas, tarefas) — tabela própria, não uma coluna a mais em
-- `conversations`, porque nem todo lead de CRM tem necessariamente uma
-- conversa (ex: cadastro manual "+ Novo Lead Real" antes do primeiro
-- contato) e vice-versa. Chave natural (tenant_id, phone), igual ao padrão
-- já usado em conversations/pre_reservations.
--
-- "Auto-criação de card novo quando conversa chega" é feita sem gravar nada
-- aqui automaticamente: GET /api/crm/leads (server/routes/crm.ts) já
-- combina toda conversa real sem linha nesta tabela com um estágio padrão
-- "novo" na resposta — só grava uma linha de verdade quando o operador
-- interage de verdade (muda estágio, adiciona nota/tarefa, define valor).
-- Isso cumpre o requisito "nunca sobrescrever edição manual já existente" by
-- design: sem interação, não existe linha nenhuma pra sobrescrever.
--
-- Como aplicar: cole este arquivo no SQL Editor do painel Supabase do
-- projeto e rode uma vez. Idempotente, seguro rodar de novo.
--
-- NOTA (2026-08-09): apesar de uma sessão anterior ter reportado essa
-- migration como "confirmada em produção" antes do PR do CRM (#83) ser
-- mergeado, ela nunca tinha sido aplicada de verdade — GET/PATCH/DELETE
-- /api/crm/leads estavam falhando (tabela inexistente) desde o merge do
-- #83. Aplicada agora via Supabase MCP, com policy já no padrão otimizado
-- (select current_setting(...)), consistente com a issue #91.

-- name/email: só usados como fonte da verdade pra leads cadastrados
-- manualmente ("+ Novo Lead Real") que ainda não têm nenhuma conversa real
-- associada — quando existe conversa real pro mesmo (tenant_id, phone), o
-- nome da conversa sempre prevalece (ver server/routes/crm.ts), pra nunca
-- divergir do que é de fato real.
create table if not exists public.crm_lead_state (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  phone text not null,
  name text,
  email text,
  stage text not null default 'novo',
  deal_value numeric,
  assigned_operator text,
  notes jsonb not null default '[]'::jsonb,
  tasks jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, phone)
);
create index if not exists crm_lead_state_tenant_idx on public.crm_lead_state (tenant_id);

alter table public.crm_lead_state enable row level security;
alter table public.crm_lead_state force row level security;
drop policy if exists tenant_isolation on public.crm_lead_state;
create policy tenant_isolation on public.crm_lead_state
  using (tenant_id = (select current_setting('app.current_tenant_id', true))::uuid)
  with check (tenant_id = (select current_setting('app.current_tenant_id', true))::uuid);
