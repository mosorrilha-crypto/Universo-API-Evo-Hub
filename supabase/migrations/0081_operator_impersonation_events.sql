-- Impersonação: saas_admin consegue "acessar como" um operador específico
-- dentro de um tenant (pedido real: seletor de empresa já existia, mas não
-- havia jeito de agir/ver como um operador específico quando um tenant tem
-- vários). Esta tabela é o log de auditoria append-only da troca de sessão
-- (nunca a granularidade de RLS do Postgres — isso continua só por
-- tenant_id, sem mudança). Mesmo padrão de escalation_audit_events (0042):
-- só inserido, nunca atualizado/apagado.
--
-- Diferente da jornada do contato (appointment_journey_events, 0080), que é
-- best-effort (nunca bloqueia o caminho principal), uma falha ao gravar
-- aqui BLOQUEIA a troca de sessão — impersonação é uma ação sensível o
-- bastante pra nunca acontecer sem deixar rastro auditável.

create table if not exists public.operator_impersonation_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  target_operator_id uuid not null references public.operators(id) on delete cascade,
  actor_id uuid not null references public.operators(id) on delete cascade,
  event_type text not null check (event_type in ('started', 'ended')),
  reason text,
  created_at timestamptz not null default now()
);

create index if not exists operator_impersonation_events_lookup_idx
  on public.operator_impersonation_events (tenant_id, target_operator_id, created_at desc);

alter table public.operator_impersonation_events enable row level security;

-- O backend usa a chave de serviço. Mantém o padrão de isolamento por tenant
-- das tabelas existentes (ver escalation_audit_events, 0042), sem expor
-- leitura pública ou políticas permissivas.
