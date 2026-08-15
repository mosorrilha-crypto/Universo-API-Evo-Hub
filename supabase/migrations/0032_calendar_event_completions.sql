-- Pedido real (15/08/2026): a Agenda do painel (UpcomingEventsPanel) só
-- mostrava os próximos N dias a partir de agora, sem filtro de mês nem jeito
-- de marcar um atendimento como concluído — parecia "desatualizada" porque
-- todo compromisso passado sumia sem deixar rastro nenhum de "aconteceu ou
-- não".
--
-- Os eventos em si continuam vivendo 100% no Google Calendar real (nunca
-- duplicados aqui) — esta tabela só guarda a marca "concluído" por evento,
-- porque o Calendar não tem esse conceito nativo que dê pra usar aqui sem
-- mexer no evento real do cliente. Funciona pra QUALQUER evento (criado pelo
-- agente/painel ou direto no Google Calendar), não só os que passam por
-- `appointments`.

create table if not exists public.calendar_event_completions (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  event_id text not null,
  completed_at timestamptz not null default now(),
  primary key (tenant_id, event_id)
);

alter table public.calendar_event_completions enable row level security;
alter table public.calendar_event_completions force row level security;
drop policy if exists tenant_isolation on public.calendar_event_completions;
create policy tenant_isolation on public.calendar_event_completions
  using (tenant_id = (select current_setting('app.current_tenant_id', true))::uuid)
  with check (tenant_id = (select current_setting('app.current_tenant_id', true))::uuid);
