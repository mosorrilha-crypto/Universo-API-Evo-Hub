-- Acompanhamento de funil (pedido real, 15/08/2026 — auditoria de conversas
-- reais mostrou ZERO agendamentos fechados no dia apesar de 31 conversas
-- ativas): duas situações fazem um lead esfriar sem ninguém saber —
-- (1) a IA pediu uma foto/dado pra Monique avaliar (trabalho anterior,
-- pigmento antigo) e ainda não tem a decisão dela; (2) a IA ofereceu
-- horário/opção e o cliente nunca respondeu. Mesmo espírito de
-- pre_reservations/preReservationFollowUpJob.ts: nunca reabre contato
-- sozinho, só registra o "due_at" e um job periódico escala pro operador
-- humano via Escalonamentos quando vence.
create table if not exists public.pending_followups (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  phone text not null,
  contact_name text,
  -- 'owner_review' = esperando avaliação da dona do negócio (ex: foto de
  -- trabalho anterior); 'customer_reply' = IA ofereceu algo e o cliente
  -- sumiu antes de responder.
  kind text not null check (kind in ('owner_review', 'customer_reply')),
  reason text not null,
  -- Calculado na hora de criar o registro: fim do dia útil (owner_review)
  -- ou agora + ~2h30 (customer_reply) — ver pendingFollowUpStore.ts.
  due_at timestamptz not null,
  created_at timestamptz not null default now(),
  followup_alerted_at timestamptz
);
create index if not exists pending_followups_due_idx
  on public.pending_followups (due_at) where followup_alerted_at is null;
create index if not exists pending_followups_tenant_phone_kind_idx
  on public.pending_followups (tenant_id, phone, kind);

alter table public.pending_followups enable row level security;
alter table public.pending_followups force row level security;
drop policy if exists tenant_isolation on public.pending_followups;
create policy tenant_isolation on public.pending_followups
  using (tenant_id = (select current_setting('app.current_tenant_id', true))::uuid)
  with check (tenant_id = (select current_setting('app.current_tenant_id', true))::uuid);
