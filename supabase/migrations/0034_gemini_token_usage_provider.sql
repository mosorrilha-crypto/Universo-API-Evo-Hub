-- [Router fallback Groq] Plano aprovado: classifyAgent (server/services/
-- autoReply.ts) passa a tentar o Groq primeiro (1 tentativa curta, mais
-- barato/rápido) antes de cair pro Gemini de sempre. Sem uma coluna que
-- diga qual provedor gerou cada linha, a telemetria de tokens/custo por
-- tenant (server/services/tokenUsageStore.ts) misturaria uso dos dois
-- provedores como se fosse tudo Gemini — não dá pra auditar quanto cada um
-- está de fato custando/sendo usado.
--
-- default 'gemini' cobre as linhas já existentes (todas geradas só pelo
-- Gemini até aqui) sem precisar de backfill manual.
--
-- Como aplicar: cole este arquivo no SQL Editor do painel Supabase do
-- projeto e rode uma vez. Idempotente, seguro rodar de novo.

alter table public.gemini_token_usage
  add column if not exists provider text not null default 'gemini' check (provider in ('gemini', 'groq'));

create index if not exists gemini_token_usage_provider_idx on public.gemini_token_usage (tenant_id, provider, created_at);
