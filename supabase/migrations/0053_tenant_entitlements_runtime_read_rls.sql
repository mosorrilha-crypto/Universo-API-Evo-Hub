-- TASK-0086 / PR #435 — leitura tenant-scoped de entitlements sob RLS.
--
-- A migration 0052 protegeu corretamente os catálogos globais da API pública,
-- mas o resolver tenant-scoped agora usa getDb() e precisa enxergar apenas as
-- definições associadas à assinatura do tenant do JWT atual. Acesso de
-- plataforma (saas_admin) segue via service key nas funções explícitas.

-- Os grants anteriores eram de negação total para anon/authenticated. O papel
-- authenticated recebe somente SELECT; o RLS abaixo restringe cada linha ao
-- plano realmente vinculado ao tenant no JWT de runtime.
grant select on table public.features to authenticated;
grant select on table public.plans to authenticated;
grant select on table public.plan_feature_rules to authenticated;

-- business_models permanece exclusivamente de plataforma e conserva a policy
-- restritiva criada em 0052.
drop policy if exists platform_only_deny_api on public.features;
drop policy if exists platform_only_deny_api on public.plans;
drop policy if exists platform_only_deny_api on public.plan_feature_rules;

drop policy if exists tenant_visible_features on public.features;
create policy tenant_visible_features
on public.features
for select
to authenticated
using (
  status = 'active'
  and exists (
    select 1
    from public.plan_feature_rules rule
    join public.tenant_subscriptions subscription on subscription.plan_id = rule.plan_id
    where rule.feature_id = features.id
      and subscription.tenant_id = (select public.current_runtime_tenant_id())
      and subscription.status in ('trial', 'active')
      and subscription.ended_at is null
  )
);

drop policy if exists tenant_visible_current_plan on public.plans;
create policy tenant_visible_current_plan
on public.plans
for select
to authenticated
using (
  exists (
    select 1
    from public.tenant_subscriptions subscription
    where subscription.plan_id = plans.id
      and subscription.tenant_id = (select public.current_runtime_tenant_id())
      and subscription.status in ('trial', 'active')
      and subscription.ended_at is null
  )
);

drop policy if exists tenant_visible_current_plan_rules on public.plan_feature_rules;
create policy tenant_visible_current_plan_rules
on public.plan_feature_rules
for select
to authenticated
using (
  exists (
    select 1
    from public.tenant_subscriptions subscription
    where subscription.plan_id = plan_feature_rules.plan_id
      and subscription.tenant_id = (select public.current_runtime_tenant_id())
      and subscription.status in ('trial', 'active')
      and subscription.ended_at is null
  )
);
