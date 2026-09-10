-- TASK-0249 — pedido direto do dono do produto: poder ver a lista completa
-- de perguntas sintéticas geradas numa rodada de avaliação automática, COM
-- as respostas — inclusive os casos que PASSARAM, não só os que falharam.
-- Antes desta tabela, `runAgentEvaluation` (agentEvalService.ts) já
-- calculava o resultado de cada caso (pergunta, resposta, aprovado/não,
-- motivo) via `onCaseResult`, mas a rota do painel
-- (POST /api/quality-audit/eval-runs em qualityAudit.ts) nunca conectava
-- esse callback a lugar nenhum — só os casos que FALHAM viravam achado em
-- quality_reviews; um caso aprovado desaparecia sem deixar rastro, então
-- não tinha como o dono do negócio conferir se o julgador (que já errou
-- várias vezes nesta mesma sessão, ver TASK-0233 em diante) realmente
-- acertou nos casos que aprovou.

create table if not exists public.agent_eval_run_cases (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.agent_eval_runs(id) on delete cascade,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  category text not null,
  question text not null,
  history jsonb,
  agent text,
  bubbles jsonb,
  passed boolean not null,
  safety_approved boolean,
  safety_reason text,
  quality_issues jsonb,
  suggested_fix text,
  error text,
  created_at timestamptz not null default now()
);

create index if not exists agent_eval_run_cases_run_idx
  on public.agent_eval_run_cases (run_id, created_at);

alter table public.agent_eval_run_cases enable row level security;
alter table public.agent_eval_run_cases force row level security;

drop policy if exists tenant_jwt_isolation on public.agent_eval_run_cases;
create policy tenant_jwt_isolation on public.agent_eval_run_cases
  for all to authenticated
  using (tenant_id = (select public.current_runtime_tenant_id()))
  with check (tenant_id = (select public.current_runtime_tenant_id()));

comment on table public.agent_eval_run_cases is 'Cada caso sintético (pergunta + resposta real + veredito) de uma rodada de agent_eval_runs — inclui casos aprovados E reprovados, pra o dono do negócio auditar o julgador, não só os achados de bug (TASK-0249).';
