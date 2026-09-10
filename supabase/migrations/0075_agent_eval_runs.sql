-- TASK-0208 — botão no painel (Central de Qualidade) pra disparar a
-- avaliação automática do agente (TASK-0203, scripts/eval-agent.ts) sem
-- terminal. Uma rodada de N casos leva minutos (cada caso faz várias
-- chamadas Gemini sequenciais), não cabe numa requisição HTTP síncrona —
-- esta tabela guarda o progresso de uma rodada em background pra a UI
-- fazer polling. Os ACHADOS em si continuam em quality_reviews (kind=bug,
-- context.source=synthetic_eval); esta tabela é só o status da execução.

create table if not exists public.agent_eval_runs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  status text not null default 'running' check (status in ('running', 'completed', 'failed')),
  requested_count integer not null check (requested_count > 0),
  completed_count integer not null default 0,
  pass_count integer not null default 0,
  fail_count integer not null default 0,
  repeated_phrase_count integer not null default 0,
  error text,
  requested_by uuid references public.operators(id) on delete set null,
  started_at timestamptz not null default now(),
  finished_at timestamptz
);

create index if not exists agent_eval_runs_tenant_started_idx
  on public.agent_eval_runs (tenant_id, started_at desc);

alter table public.agent_eval_runs enable row level security;
alter table public.agent_eval_runs force row level security;

drop policy if exists tenant_jwt_isolation on public.agent_eval_runs;
create policy tenant_jwt_isolation on public.agent_eval_runs
  for all to authenticated
  using (tenant_id = (select public.current_runtime_tenant_id()))
  with check (tenant_id = (select public.current_runtime_tenant_id()));

comment on table public.agent_eval_runs is 'Progresso de uma rodada de avaliação automática sintética do agente (TASK-0203/0208) — achados ficam em quality_reviews, isto é só status de execução em background.';
