-- Disparo em Massa vira módulo opt-in por tenant (TASK-0252) — nasce fechado
-- pra todo mundo (default_enabled=false), igual Logs do Sistema; o trigger
-- features_seed_disabled_rule (migration 0063) já popula plan_feature_rules
-- sozinho. Só um override manual do SaaS Admin libera por tenant.
insert into public.features (key, name, domain, kind, status, default_enabled)
values ('marketing.broadcast', 'Disparo em Massa', 'marketing', 'boolean', 'active', false)
on conflict (key) do update
set name = excluded.name,
    domain = excluded.domain,
    kind = excluded.kind,
    status = excluded.status,
    default_enabled = false;
