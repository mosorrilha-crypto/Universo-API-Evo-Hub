-- Novos recursos operacionais nascem fechados para tenants. O SaaS Admin os
-- libera pelo override já existente no Centro de Controle, sem uma API paralela.
alter table public.features
  add column if not exists default_enabled boolean not null default false;

-- Preserva o comportamento dos recursos que já existiam antes desta política.
update public.features
set default_enabled = true
where key <> 'operations.system_logs';

insert into public.features (key, name, domain, kind, status, default_enabled)
values ('operations.system_logs', 'Logs do Sistema', 'operations', 'configurable', 'active', false)
on conflict (key) do update
set name = excluded.name,
    domain = excluded.domain,
    kind = excluded.kind,
    status = excluded.status,
    default_enabled = false;

-- Todo feature criado daqui em diante recebe regra explicitamente fechada nos
-- planos existentes; somente um override do SaaS Admin o disponibiliza ao tenant.
create or replace function public.seed_disabled_rule_for_new_feature()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.plan_feature_rules (plan_id, feature_id, enabled, limit_value, config)
  select p.id, new.id, false, null, '{}'::jsonb
  from public.plans p
  where p.status in ('active', 'draft')
  on conflict (plan_id, feature_id) do nothing;
  return new;
end;
$$;

drop trigger if exists features_seed_disabled_rule on public.features;
create trigger features_seed_disabled_rule
after insert on public.features
for each row execute function public.seed_disabled_rule_for_new_feature();

-- Inclui a feature inserida antes da criação do trigger nos planos já existentes.
insert into public.plan_feature_rules (plan_id, feature_id, enabled, limit_value, config)
select p.id, f.id, false, null, '{}'::jsonb
from public.plans p
join public.features f on f.key = 'operations.system_logs'
where p.status in ('active', 'draft')
on conflict (plan_id, feature_id) do nothing;
