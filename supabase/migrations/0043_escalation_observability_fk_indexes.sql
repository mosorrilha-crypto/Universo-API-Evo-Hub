-- Índices de integridade referencial para as tabelas de governança e observabilidade.
-- Mantêm deleções/consultas por ator ou caso sem varredura completa, conforme
-- apontado pelo advisor após a migração 0042.

create index if not exists conversation_analyses_created_by_idx
  on public.conversation_analyses (created_by);

create index if not exists escalation_audit_events_escalation_id_idx
  on public.escalation_audit_events (escalation_id);

create index if not exists escalation_audit_events_actor_id_idx
  on public.escalation_audit_events (actor_id);

create index if not exists escalations_resolved_by_idx
  on public.escalations (resolved_by);

create index if not exists operation_events_escalation_id_idx
  on public.operation_events (escalation_id);
