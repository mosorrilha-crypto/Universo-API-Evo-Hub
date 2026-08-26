-- TASK-0093 — fecha o ciclo do revisor pré-envio: guarda o rascunho bloqueado
-- de forma estruturada e registra exemplos aprovados por humano pra
-- alimentar o agente em situações parecidas no futuro (nunca automático —
-- só depois que um operador aprova e envia de verdade).

alter table public.escalations
  add column if not exists blocked_draft text;

create table if not exists public.tenant_approved_reply_examples (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  escalation_id text references public.escalations(id) on delete set null,
  customer_message text not null,
  approved_reply text not null,
  reviewer_reason text,
  created_by text,
  created_at timestamptz not null default now()
);
create index if not exists tenant_approved_reply_examples_tenant_created_idx
  on public.tenant_approved_reply_examples (tenant_id, created_at desc);

alter table public.tenant_approved_reply_examples enable row level security;
alter table public.tenant_approved_reply_examples force row level security;
drop policy if exists tenant_jwt_isolation on public.tenant_approved_reply_examples;
create policy tenant_jwt_isolation on public.tenant_approved_reply_examples
  for all to authenticated
  using (tenant_id = (select public.current_runtime_tenant_id()))
  with check (tenant_id = (select public.current_runtime_tenant_id()));
