-- [Telemetria] Registro real de uso de tokens Gemini por tenant — GitHub
-- issue #90 (da auditoria estrutural #82, item 5). Confirmado que nenhuma
-- gravação de usageMetadata existia no backend; /api/telemetry/tokens
-- respondia vazio honestamente, mas o dado nunca era gravado em primeiro
-- lugar. Sem isso, um SaaS cobrando de tenants reais com IA por trás não
-- tem visibilidade de custo por tenant/conversa, nem forma de diagnosticar
-- se falhas do Gemini são por cota/429 (ver issue "🔴 Gemini falhando").
--
-- Uma linha por chamada Gemini (server/services/autoReply.ts:
-- withGeminiRetry, os 4 pontos de chamada: router/especialista/agendamento/
-- foto) — não agregado na gravação, agregação acontece na leitura
-- (server/services/tokenUsageStore.ts), pra nunca perder granularidade de
-- diagnóstico por chamada.
--
-- Como aplicar: cole este arquivo no SQL Editor do painel Supabase do
-- projeto e rode uma vez. Idempotente, seguro rodar de novo.
--
-- Policy já usa (select current_setting(...)) em vez de current_setting(...)
-- direto — mesmo padrão otimizado que a issue #91 aplicou nas 14 tabelas
-- pré-existentes, pra não nascer já com o mesmo problema de performance
-- (auth_rls_initplan) que essa outra issue corrigiu.

create table if not exists public.gemini_token_usage (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  call_site text not null check (call_site in ('router', 'especialista', 'agendamento', 'foto')),
  prompt_tokens integer not null default 0,
  candidates_tokens integer not null default 0,
  total_tokens integer not null default 0,
  cached_tokens integer not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists gemini_token_usage_tenant_idx on public.gemini_token_usage (tenant_id, created_at);

alter table public.gemini_token_usage enable row level security;
alter table public.gemini_token_usage force row level security;
drop policy if exists tenant_isolation on public.gemini_token_usage;
create policy tenant_isolation on public.gemini_token_usage
  using (tenant_id = (select current_setting('app.current_tenant_id', true))::uuid)
  with check (tenant_id = (select current_setting('app.current_tenant_id', true))::uuid);
