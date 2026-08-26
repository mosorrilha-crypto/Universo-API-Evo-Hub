-- Tabelas globais de plataforma: bloqueio explícito para a API pública.
--
-- Estas relações não possuem tenant_id e não devem ser acessadas por clientes
-- anon/autenticados via PostgREST. Seus únicos consumidores legítimos são
-- serviços backend com chave de plataforma: prompt global, deduplicação de
-- webhook e backlog do SaaS Master.
--
-- A policy restritiva remove o alerta "RLS enabled, no policy" sem abrir uma
-- policy permissiva. Os grants são revogados como defesa em profundidade;
-- getPlatformDb usa a service key e continua sendo o caminho explícito de
-- manutenção global.

revoke all privileges on table public.global_prompt_layer from anon, authenticated;
revoke all privileges on table public.processed_webhook_messages from anon, authenticated;
revoke all privileges on table public.roadmap_items from anon, authenticated;

alter table public.global_prompt_layer enable row level security;
alter table public.global_prompt_layer force row level security;
drop policy if exists platform_only_deny_api on public.global_prompt_layer;
create policy platform_only_deny_api
on public.global_prompt_layer
as restrictive
for all
to anon, authenticated
using (false)
with check (false);

alter table public.processed_webhook_messages enable row level security;
alter table public.processed_webhook_messages force row level security;
drop policy if exists platform_only_deny_api on public.processed_webhook_messages;
create policy platform_only_deny_api
on public.processed_webhook_messages
as restrictive
for all
to anon, authenticated
using (false)
with check (false);

alter table public.roadmap_items enable row level security;
alter table public.roadmap_items force row level security;
drop policy if exists platform_only_deny_api on public.roadmap_items;
create policy platform_only_deny_api
on public.roadmap_items
as restrictive
for all
to anon, authenticated
using (false)
with check (false);
