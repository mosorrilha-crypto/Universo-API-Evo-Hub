-- Camada 1 (Global) do prompt do agente (docs/AGENTE-VERTICAL-ARQUITETURA.md
-- seção 1) hoje é uma string fixa no código (autoReply.ts, GLOBAL_LAYER) —
-- qualquer ajuste real de produção (ex: uma regra anti-alucinação nova)
-- exige PR + deploy. Pedido real do dono do produto: poder editar essa
-- camada direto pelo painel SaaS Admin quando encontrar um problema numa
-- conversa real, sem depender de uma sessão de desenvolvimento a cada vez.
--
-- Singleton (1 linha só, id fixo 'global') — não é por tenant, é o prompt
-- fixo compartilhado por TODOS os tenants. content NULL = usa o texto
-- padrão hardcoded no código (DEFAULT_GLOBAL_LAYER em autoReply.ts); só
-- passa a valer o texto daqui quando um saas_admin salva algo pelo painel.
--
-- Como aplicar: cole este arquivo no SQL Editor do painel Supabase do
-- projeto e rode uma vez. Idempotente, seguro rodar de novo.

create table if not exists public.global_prompt_layer (
  id text primary key default 'global',
  content text,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.operators(id)
);

-- Sem policy nenhuma, RLS habilitado é deny-all pra anon/authenticated — a
-- service key do backend continua funcionando normal (bypassa RLS, mesmo
-- padrão do resto do schema, ver 0025_processed_webhook_messages.sql).
alter table public.global_prompt_layer enable row level security;
alter table public.global_prompt_layer force row level security;
