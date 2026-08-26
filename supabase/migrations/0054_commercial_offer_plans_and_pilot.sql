-- TASK-0091 — Planos comerciais, metadados de oferta e tenant piloto isolado.
-- Nenhum tenant existente é movido do plano de compatibilidade.

alter table public.plans
  add column if not exists commercial_metadata jsonb not null default '{}'::jsonb;

-- Os preços são informação comercial pública; não autorizam acesso. A decisão
-- efetiva continua em plan_feature_rules + tenant_subscriptions.
insert into public.plans (key, name, version, business_model_id, status, description, commercial_metadata)
select
  offer.key,
  offer.name,
  1,
  business_model.id,
  'active',
  offer.description,
  offer.metadata::jsonb
from public.business_models business_model
cross join (
  values
    ('essencial', 'Essencial', 'Organize leads, agenda e vendas em uma única operação.', '{"currency":"PYG","monthly_price":349000,"display_price":"Gs. 349.000/mês","featured":false,"audience":"Negócios que querem centralizar atendimento e agendamento."}'),
    ('profissional', 'Profissional', 'Automatize atendimento, acompanhamento e crescimento com IA.', '{"currency":"PYG","monthly_price":649000,"display_price":"Gs. 649.000/mês","featured":true,"audience":"Negócios que querem escalar conversão com agente de IA."}')
) as offer(key, name, description, metadata)
where business_model.key = 'generic'
on conflict (key, version) do update
set name = excluded.name,
    status = excluded.status,
    description = excluded.description,
    commercial_metadata = excluded.commercial_metadata,
    updated_at = now();

-- Os planos comerciais sempre recebem uma regra para cada feature ativa. Isso
-- impede que a compatibilidade positiva do resolver torne uma feature omitida
-- involuntariamente disponível em uma oferta nova.
with plan_features as (
  select
    plan.id as plan_id,
    plan.key as plan_key,
    feature.id as feature_id,
    feature.key as feature_key
  from public.plans plan
  cross join public.features feature
  where plan.key in ('essencial', 'profissional')
    and plan.version = 1
    and feature.status = 'active'
), mapped_rules as (
  select
    plan_id,
    feature_id,
    case
      when plan_key = 'profissional' then true
      when feature_key in (
        'inbox.conversations',
        'booking.calendar',
        'crm.follow_ups',
        'sales.financial',
        'catalog.public_page',
        'channel.meta_whatsapp',
        'channel.evolution',
        'admin.tenant_operators'
      ) then true
      else false
    end as enabled,
    case
      when plan_key = 'profissional' and feature_key = 'ai.auto_reply' then 2500
      when plan_key = 'profissional' and feature_key = 'booking.reminders' then 1000
      when plan_key = 'profissional' and feature_key = 'crm.follow_ups' then 2000
      when plan_key = 'profissional' and feature_key = 'admin.tenant_operators' then 10
      when plan_key = 'essencial' and feature_key = 'crm.follow_ups' then 500
      when plan_key = 'essencial' and feature_key = 'admin.tenant_operators' then 3
      else null
    end as limit_value
  from plan_features
)
insert into public.plan_feature_rules (plan_id, feature_id, enabled, limit_value, config)
select plan_id, feature_id, enabled, limit_value, '{}'::jsonb
from mapped_rules
on conflict (plan_id, feature_id) do update
set enabled = excluded.enabled,
    limit_value = excluded.limit_value,
    config = excluded.config,
    updated_at = now();

-- O piloto não recebe telefone, token, operador ou conteúdo de cliente; fica
-- inativo para não atender leads reais. É usado exclusivamente para validar a
-- composição Essencial e o painel de entitlements.
insert into public.tenants (name, slug, currency, locale, segment, is_active)
select 'Piloto Comercial Essencial', 'piloto-comercial-essencial', 'PYG', 'es-PY', 'generic', false
where not exists (
  select 1 from public.tenants where slug = 'piloto-comercial-essencial'
);

with pilot as (
  select id from public.tenants where slug = 'piloto-comercial-essencial' limit 1
), plan as (
  select id, key, version from public.plans where key = 'essencial' and version = 1 limit 1
), current_subscription as (
  select subscription.id
  from public.tenant_subscriptions subscription
  join pilot on pilot.id = subscription.tenant_id
  where subscription.status in ('trial', 'active')
    and subscription.ended_at is null
)
insert into public.tenant_subscriptions (tenant_id, plan_id, status, started_at, assigned_by, reason)
select pilot.id, plan.id, 'trial', now(), 'migration:0054', 'Tenant piloto isolado para validar a oferta Essencial sem impactar clientes existentes.'
from pilot
cross join plan
where not exists (select 1 from current_subscription);

insert into public.tenant_entitlement_audit (tenant_id, action, after_state, actor_id, reason)
select
  pilot.id,
  'subscription_changed',
  jsonb_build_object('plan_key', plan.key, 'plan_version', plan.version, 'status', 'trial'),
  'migration:0054',
  'Tenant piloto isolado para validar a oferta Essencial sem impactar clientes existentes.'
from public.tenants pilot
join public.plans plan on plan.key = 'essencial' and plan.version = 1
where pilot.slug = 'piloto-comercial-essencial'
  and not exists (
    select 1 from public.tenant_entitlement_audit audit
    where audit.tenant_id = pilot.id
      and audit.actor_id = 'migration:0054'
      and audit.action = 'subscription_changed'
  );
