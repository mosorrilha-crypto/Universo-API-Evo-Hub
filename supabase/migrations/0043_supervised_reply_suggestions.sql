-- Sugestões corrigidas do revisor ágil — sempre sob revisão humana.
-- A sugestão fica separada de operator_reply: ela pode ser editada/copied
-- pelo operador, mas nunca é consumida pelo webhook nem enviada sozinha.

alter table public.escalations
  add column if not exists suggested_reply text,
  add column if not exists suggested_reply_at timestamptz,
  add column if not exists suggested_reply_status text,
  add column if not exists suggested_reply_source text;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'escalations_suggested_reply_status_check'
  ) then
    alter table public.escalations
      add constraint escalations_suggested_reply_status_check
      check (suggested_reply_status is null or suggested_reply_status in ('generated', 'edited', 'copied', 'discarded'));
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'escalations_suggested_reply_source_check'
  ) then
    alter table public.escalations
      add constraint escalations_suggested_reply_source_check
      check (suggested_reply_source is null or suggested_reply_source in ('groq-suggestion', 'gemini-suggestion'));
  end if;
end $$;

create index if not exists escalations_tenant_suggestion_status_idx
  on public.escalations (tenant_id, suggested_reply_status, suggested_reply_at desc);
