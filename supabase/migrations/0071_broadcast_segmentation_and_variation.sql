-- Resolve as 2 últimas pendências do Backlog Técnico do Disparo em Massa
-- (auditoria de 2026-08-30, TASK-0171/TASK-0173):
--
-- (1) Segmentar a lista de contatos por dados reais já existentes no
-- sistema, em vez de exigir sempre CSV externo. "Já se inscreveu no
-- evento X" não tem nenhuma entidade correspondente no sistema (nunca
-- existiu um conceito de inscrição em evento) — não inventamos uma só
-- pra isso; os 2 segmentos abaixo usam tabelas que já existem de verdade:
-- `conversations` (já é lead/já conversou) e `appointments` (já tem
-- agendamento confirmado, eventId real no Google Calendar).
alter table public.broadcast_contact_lists
  add column if not exists source text not null default 'csv'
    check (source in ('csv', 'segment_known_leads', 'segment_has_appointment'));

-- (2) Variação de template — uma campanha pode citar 2+ templates
-- equivalentes (mesma mensagem reescrita, aprovados separadamente na
-- Meta) e o job alterna entre eles por destinatário (round-robin),
-- reduzindo "todo mundo recebe o texto idêntico" como sinal de spam.
create table if not exists public.broadcast_campaign_templates (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.broadcast_campaigns(id) on delete cascade,
  template_id uuid not null references public.broadcast_templates(id) on delete restrict,
  -- upload de header de imagem é por template (cada um pode ter uma
  -- imagem de exemplo diferente aprovada), mesmo padrão de
  -- broadcast_campaigns.header_media_id só que 1 por template da campanha.
  header_media_id text,
  created_at timestamptz not null default now(),
  unique (campaign_id, template_id)
);

alter table public.broadcast_campaign_recipients
  add column if not exists template_id uuid references public.broadcast_templates(id) on delete set null;

alter table public.broadcast_campaign_templates enable row level security;
alter table public.broadcast_campaign_templates force row level security;

-- broadcast_campaign_templates não tem tenant_id próprio (é só um join
-- campanha↔template), mesmo padrão de isolamento via subquery já usado
-- em broadcast_campaign_numbers (0068_broadcast_marketing.sql).
drop policy if exists tenant_jwt_isolation on public.broadcast_campaign_templates;
create policy tenant_jwt_isolation on public.broadcast_campaign_templates
  for all to authenticated
  using (campaign_id in (
    select id from public.broadcast_campaigns
    where tenant_id = (select public.current_runtime_tenant_id())
  ))
  with check (campaign_id in (
    select id from public.broadcast_campaigns
    where tenant_id = (select public.current_runtime_tenant_id())
  ));
