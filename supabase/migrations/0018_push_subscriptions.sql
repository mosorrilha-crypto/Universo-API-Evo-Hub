-- Issue #159 — push notification (Web Push) pro app instalável (PWA) do
-- atendente, pra não depender só de o operador estar olhando o painel no
-- desktop pra perceber um escalonamento novo ou uma mensagem que a IA não
-- vai responder sozinha.
--
-- Uma linha por assinatura de push do navegador (não por operador — a mesma
-- pessoa pode ter mais de uma, ex: celular + desktop instalado). endpoint é
-- único por natureza (URL do serviço de push do navegador/OS), então serve
-- de chave de upsert natural: reinstalar o PWA ou reautorizar notificação
-- gera o mesmo endpoint, sem duplicar linha.
--
-- p256dh/auth: as duas chaves públicas da assinatura Web Push (RFC 8291),
-- exigidas pra criptografar o payload — não são segredo do servidor, vêm do
-- browser, mas precisam ficar junto do endpoint pra reconstruir o envio.
--
-- Como aplicar: cole este arquivo no SQL Editor do painel Supabase do
-- projeto e rode uma vez. Idempotente, seguro rodar de novo.

create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  operator_id uuid not null references public.operators(id) on delete cascade,
  endpoint text not null,
  p256dh text not null,
  auth text not null,
  user_agent text,
  created_at timestamptz not null default now(),
  unique (endpoint)
);
create index if not exists push_subscriptions_tenant_idx
  on public.push_subscriptions (tenant_id);
create index if not exists push_subscriptions_operator_idx
  on public.push_subscriptions (operator_id);

-- Row Level Security — mesmo padrão das outras tabelas do schema, já na
-- forma otimizada (select current_setting(...)) corrigida em
-- 0015_rls_advisor_fixes.sql pras tabelas anteriores. A service key do
-- backend ainda bypassa RLS hoje; políticas ficam prontas e corretas mesmo
-- assim (defesa em profundidade, não bloqueante).
alter table public.push_subscriptions enable row level security;
alter table public.push_subscriptions force row level security;
drop policy if exists tenant_isolation on public.push_subscriptions;
create policy tenant_isolation on public.push_subscriptions
  using (tenant_id = (select current_setting('app.current_tenant_id', true))::uuid)
  with check (tenant_id = (select current_setting('app.current_tenant_id', true))::uuid);
