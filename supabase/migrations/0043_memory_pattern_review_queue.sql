-- Fila supervisionada de padrões de memória.
-- Os registros guardam somente chaves de campo e evidência agregada; nunca
-- armazenam telefone, mensagem, valores corrigidos, prompts ou estados vivos.

create table if not exists public.memory_pattern_reviews (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  pattern_key text not null check (pattern_key in ('preferredLanguage', 'preferredName', 'currentIntent', 'serviceInterest', 'objections', 'nextBestAction')),
  evidence_count integer not null default 0 check (evidence_count >= 0),
  agent_routes jsonb not null default '[]'::jsonb,
  status text not null default 'pending' check (status in ('pending', 'observed', 'knowledge_draft', 'prompt_test', 'dismissed')),
  review_note text,
  linked_quality_review_id uuid references public.quality_reviews(id) on delete set null,
  created_by uuid references public.operators(id) on delete set null,
  decided_by uuid references public.operators(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, pattern_key)
);

create index if not exists memory_pattern_reviews_tenant_status_updated_idx
  on public.memory_pattern_reviews (tenant_id, status, updated_at desc);

alter table public.memory_pattern_reviews enable row level security;

drop policy if exists memory_pattern_reviews_tenant_access on public.memory_pattern_reviews;
create policy memory_pattern_reviews_tenant_access on public.memory_pattern_reviews
  for all using (tenant_id = (select current_setting('app.current_tenant_id', true))::uuid)
  with check (tenant_id = (select current_setting('app.current_tenant_id', true))::uuid);
