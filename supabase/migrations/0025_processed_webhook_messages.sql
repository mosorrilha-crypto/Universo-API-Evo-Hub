-- Idempotência de mensagens de webhook compartilhada entre instâncias
-- (server/services/idempotency.ts era um Set em memória por processo — não
-- pegava reentrega da Meta/Evolution quando ela caía numa instância
-- diferente do Render, ou depois de um restart de deploy; achado real
-- investigando respostas duplicadas da IA pra leads reais, ver PLANO-EVOLUCAO
-- item 1.1.7).
--
-- Sem tenant_id de propósito: o tenant da mensagem só é resolvido DEPOIS da
-- checagem de idempotência em webhooks.ts (a claim precisa acontecer antes
-- de saber de quem é a mensagem), e o message_id do provider (Meta/Evolution)
-- já é globalmente único — não há dado de negócio nem PII aqui, só o ID de
-- controle. RLS de isolamento por tenant não se aplica.
--
-- Sem job de limpeza por ora (linha cresce sem purge) — volume real do
-- produto é modesto; revisitar se isso virar um problema de tamanho de
-- tabela.
--
-- Como aplicar: cole este arquivo no SQL Editor do painel Supabase do
-- projeto e rode uma vez. Idempotente, seguro rodar de novo.

create table if not exists public.processed_webhook_messages (
  message_id text primary key,
  created_at timestamptz not null default now()
);
create index if not exists processed_webhook_messages_created_at_idx
  on public.processed_webhook_messages (created_at);

-- Sem policy nenhuma, RLS habilitado é deny-all pra anon/authenticated — a
-- service key do backend continua funcionando normal (bypassa RLS, mesmo
-- padrão do resto do schema). Sem isso a tabela fica exposta via PostgREST
-- pra qualquer um com a chave anon (achado pelo advisor de segurança do
-- Supabase logo depois de criar a tabela).
alter table public.processed_webhook_messages enable row level security;
alter table public.processed_webhook_messages force row level security;
