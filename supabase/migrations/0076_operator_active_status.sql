-- TASK-0261 — bloqueio reversível de operador, separado da exclusão
-- definitiva já existente (DELETE /api/admin/operators/:id). Mesmo padrão
-- de tenants.is_active (migration 0048_tenant_access_block_and_billing.sql).
alter table public.operators add column if not exists is_active boolean not null default true;
