import { getDb, getPlatformDb } from './db';
import { getTenantDbContext } from './tenantDbContext';

export type EntitlementSource = 'plan' | 'override' | 'compatibility';

export interface FeatureDefinition {
  id: string;
  key: string;
  name: string;
  domain: string;
  kind: 'boolean' | 'quota' | 'configurable';
  status: 'active' | 'retired';
}

export interface PlanFeatureRule {
  feature_id: string;
  enabled: boolean;
  limit_value: number | null;
  config: Record<string, unknown> | null;
}

export interface FeatureOverride {
  id: string;
  feature_id: string;
  enabled: boolean | null;
  limit_value: number | null;
  config: Record<string, unknown> | null;
  expires_at: string | null;
  revoked_at: string | null;
  reason: string;
}

export interface FeatureUsage {
  feature_id: string;
  metric: string;
  period_start: string;
  value: number;
}

export interface EffectiveEntitlement {
  featureId: string;
  key: string;
  name: string;
  domain: string;
  kind: FeatureDefinition['kind'];
  enabled: boolean;
  limitValue: number | null;
  usage: number;
  remaining: number | null;
  config: Record<string, unknown>;
  source: EntitlementSource;
  override: { id: string; reason: string; expiresAt: string | null } | null;
}

export interface TenantEntitlements {
  tenantId: string;
  subscription: {
    id: string;
    status: string;
    startedAt: string;
    endedAt: string | null;
    plan: { id: string; key: string; name: string; version: number } | null;
  } | null;
  entitlements: EffectiveEntitlement[];
}

const objectOrEmpty = (value: unknown): Record<string, unknown> => (
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
);

function isActiveOverride(override: FeatureOverride, now: Date): boolean {
  return !override.revoked_at && (!override.expires_at || Date.parse(override.expires_at) > now.getTime());
}

/**
 * Parte pura do resolver: toda superfície (HTTP, job ou teste) recebe a mesma
 * precedência: plano → override ativo → uso. Sem assinatura/regra durante a
 * migração, cai em compatibilidade positiva para não retirar acesso existente.
 */
export function resolveEffectiveEntitlements({
  features,
  rules,
  overrides,
  usage,
  now = new Date(),
}: {
  features: FeatureDefinition[];
  rules: PlanFeatureRule[];
  overrides: FeatureOverride[];
  usage: FeatureUsage[];
  now?: Date;
}): EffectiveEntitlement[] {
  const rulesByFeature = new Map(rules.map((rule) => [rule.feature_id, rule]));
  const overridesByFeature = new Map<string, FeatureOverride>();
  for (const override of overrides) {
    if (!isActiveOverride(override, now)) continue;
    // A consulta ordena por created_at desc; o primeiro override ativo é o
    // mais recente e prevalece. UUID não é usado como critério temporal.
    if (!overridesByFeature.has(override.feature_id)) overridesByFeature.set(override.feature_id, override);
  }
  const usageByFeature = new Map<string, number>();
  for (const item of usage) usageByFeature.set(item.feature_id, (usageByFeature.get(item.feature_id) || 0) + Number(item.value || 0));

  return features
    .filter((feature) => feature.status === 'active')
    .map((feature) => {
      const rule = rulesByFeature.get(feature.id);
      const override = overridesByFeature.get(feature.id);
      const hasOverride = Boolean(override && (override.enabled !== null || override.limit_value !== null || Object.keys(objectOrEmpty(override.config)).length));
      const enabled = override?.enabled ?? rule?.enabled ?? true;
      const limitValue = override?.limit_value ?? rule?.limit_value ?? null;
      const used = usageByFeature.get(feature.id) || 0;
      return {
        featureId: feature.id,
        key: feature.key,
        name: feature.name,
        domain: feature.domain,
        kind: feature.kind,
        enabled,
        limitValue,
        usage: used,
        remaining: limitValue === null ? null : Math.max(0, limitValue - used),
        config: { ...objectOrEmpty(rule?.config), ...objectOrEmpty(override?.config) },
        source: hasOverride ? 'override' : rule ? 'plan' : 'compatibility',
        override: override ? { id: override.id, reason: override.reason, expiresAt: override.expires_at } : null,
      } satisfies EffectiveEntitlement;
    });
}

async function requirePlan(planId: string) {
  const { data, error } = await getPlatformDb().from('plans').select('id, key, name, version, status').eq('id', planId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error('Plano não encontrado.');
  if (!['active', 'draft'].includes(data.status)) throw new Error('Plano arquivado não pode ser atribuído.');
  return data as { id: string; key: string; name: string; version: number; status: string };
}

/**
 * Financeiro é opt-in comercial: tenants novos nascem sem a capacidade e só o
 * fluxo administrativo SaaS pode criar uma exceção que a habilite. Tenants
 * existentes não são alterados automaticamente para evitar retirar operação
 * em uso durante a migração.
 */
async function disableFinancialModuleByDefault(tenantId: string, actorId: string) {
  const db = getPlatformDb();
  const { data: feature, error: featureError } = await db
    .from('features')
    .select('id')
    .eq('key', 'sales.financial')
    .eq('status', 'active')
    .maybeSingle();
  if (featureError) throw new Error(featureError.message);
  if (!feature) return;

  const { data: existing, error: existingError } = await db
    .from('tenant_feature_overrides')
    .select('id')
    .eq('tenant_id', tenantId)
    .eq('feature_id', feature.id)
    .is('revoked_at', null)
    .limit(1);
  if (existingError) throw new Error(existingError.message);
  if (existing?.length) return;

  const { data: override, error: insertError } = await db
    .from('tenant_feature_overrides')
    .insert({
      tenant_id: tenantId,
      feature_id: feature.id,
      enabled: false,
      config: {},
      reason: 'Financeiro é opcional e inicia desabilitado; a ativação depende do Admin SaaS.',
      created_by: actorId,
    })
    .select('id, feature_id, enabled, reason')
    .single();
  if (insertError) throw new Error(insertError.message);

  const { error: auditError } = await db.from('tenant_entitlement_audit').insert({
    tenant_id: tenantId,
    feature_id: feature.id,
    action: 'override_created',
    after_state: override,
    actor_id: actorId,
    reason: 'Financeiro opcional desabilitado na criação do tenant.',
  });
  if (auditError) throw new Error(auditError.message);
}

export async function listEntitlementCatalog() {
  const db = getPlatformDb();
  const [{ data: features, error: featuresError }, { data: plans, error: plansError }] = await Promise.all([
    db.from('features').select('id, key, name, domain, kind, status').order('domain').order('key'),
    db.from('plans').select('id, key, name, version, status, description').order('key').order('version', { ascending: false }),
  ]);
  if (featuresError) throw new Error(featuresError.message);
  if (plansError) throw new Error(plansError.message);
  return { features: (features || []) as FeatureDefinition[], plans: plans || [] };
}

async function resolveTenantEntitlements(db: ReturnType<typeof getDb>, tenantId: string): Promise<TenantEntitlements> {
  const [{ data: features, error: featuresError }, { data: subscriptions, error: subscriptionsError }, { data: overrides, error: overridesError }, { data: usage, error: usageError }] = await Promise.all([
    db.from('features').select('id, key, name, domain, kind, status').order('domain').order('key'),
    db.from('tenant_subscriptions').select('id, plan_id, status, started_at, ended_at').eq('tenant_id', tenantId).in('status', ['trial', 'active']).is('ended_at', null).order('started_at', { ascending: false }).limit(1),
    db.from('tenant_feature_overrides').select('id, feature_id, enabled, limit_value, config, expires_at, revoked_at, reason, created_at').eq('tenant_id', tenantId).is('revoked_at', null).order('created_at', { ascending: false }),
    db.from('tenant_feature_usage').select('feature_id, metric, period_start, value').eq('tenant_id', tenantId),
  ]);
  if (featuresError) throw new Error(featuresError.message);
  if (subscriptionsError) throw new Error(subscriptionsError.message);
  if (overridesError) throw new Error(overridesError.message);
  if (usageError) throw new Error(usageError.message);

  const subscription = subscriptions?.[0] as { id: string; plan_id: string; status: string; started_at: string; ended_at: string | null } | undefined;
  let plan: TenantEntitlements['subscription']['plan'] = null;
  let rules: PlanFeatureRule[] = [];
  if (subscription) {
    const [{ data: planRow, error: planError }, { data: ruleRows, error: rulesError }] = await Promise.all([
      db.from('plans').select('id, key, name, version').eq('id', subscription.plan_id).maybeSingle(),
      db.from('plan_feature_rules').select('feature_id, enabled, limit_value, config').eq('plan_id', subscription.plan_id),
    ]);
    if (planError) throw new Error(planError.message);
    if (rulesError) throw new Error(rulesError.message);
    plan = planRow as TenantEntitlements['subscription']['plan'];
    rules = (ruleRows || []) as PlanFeatureRule[];
  }

  return {
    tenantId,
    subscription: subscription ? { id: subscription.id, status: subscription.status, startedAt: subscription.started_at, endedAt: subscription.ended_at, plan } : null,
    entitlements: resolveEffectiveEntitlements({
      features: (features || []) as FeatureDefinition[],
      rules,
      overrides: (overrides || []) as FeatureOverride[],
      usage: (usage || []) as FeatureUsage[],
    }),
  };
}

/** Leitura do próprio tenant: sempre usa o cliente emitido sob o JWT/RLS atual. */
export async function getTenantEntitlements(): Promise<TenantEntitlements> {
  const context = getTenantDbContext();
  if (!context?.tenantId) throw new Error('Leitura de entitlements sem contexto de tenant recusada.');
  return resolveTenantEntitlements(getDb(), context.tenantId);
}

/** Leitura cross-tenant reservada para rotas saas_admin já autorizadas. */
export async function getTenantEntitlementsForPlatform(tenantId: string): Promise<TenantEntitlements> {
  return resolveTenantEntitlements(getPlatformDb(), tenantId);
}

export async function ensureTenantCompatibilitySubscription(tenantId: string, actorId = 'system:tenant-create') {
  const db = getPlatformDb();
  const { data: current, error: currentError } = await db
    .from('tenant_subscriptions')
    .select('id')
    .eq('tenant_id', tenantId)
    .in('status', ['trial', 'active'])
    .is('ended_at', null)
    .limit(1);
  if (currentError) throw new Error(currentError.message);
  if (current?.length) return current[0];
  const { data: plan, error: planError } = await db.from('plans').select('id, key, version').eq('key', 'compatibility').eq('version', 1).maybeSingle();
  if (planError) throw new Error(planError.message);
  if (!plan) throw new Error('Plano de compatibilidade não encontrado; aplique a migration de entitlements antes de criar tenants.');
  const { data: subscription, error: subscriptionError } = await db
    .from('tenant_subscriptions')
    .insert({ tenant_id: tenantId, plan_id: plan.id, status: 'active', assigned_by: actorId, reason: 'Plano de compatibilidade atribuído automaticamente na criação do tenant.' })
    .select('id, tenant_id, plan_id, status, started_at')
    .single();
  if (subscriptionError) throw new Error(subscriptionError.message);
  await db.from('tenant_entitlement_audit').insert({
    tenant_id: tenantId,
    action: 'subscription_changed',
    after_state: { planKey: plan.key, planVersion: plan.version, status: 'active' },
    actor_id: actorId,
    reason: 'Plano de compatibilidade atribuído automaticamente na criação do tenant.',
  });
  return subscription;
}

export async function changeTenantSubscription({ tenantId, planId, status = 'active', actorId, reason, requestId }: {
  tenantId: string;
  planId: string;
  status?: 'trial' | 'active' | 'paused' | 'cancelled';
  actorId: string;
  reason: string;
  requestId?: string;
}) {
  if (!reason.trim()) throw new Error('Informe o motivo da mudança de plano.');
  const db = getPlatformDb();
  const plan = await requirePlan(planId);
  const { data: currentRows, error: currentError } = await db.from('tenant_subscriptions').select('id, plan_id, status, started_at').eq('tenant_id', tenantId).in('status', ['trial', 'active']).is('ended_at', null).order('started_at', { ascending: false }).limit(1);
  if (currentError) throw new Error(currentError.message);
  const current = currentRows?.[0] || null;
  if (current) {
    const { error: closeError } = await db.from('tenant_subscriptions').update({ status: 'cancelled', ended_at: new Date().toISOString() }).eq('id', current.id).eq('tenant_id', tenantId);
    if (closeError) throw new Error(closeError.message);
  }
  const { data: subscription, error: insertError } = await db.from('tenant_subscriptions').insert({ tenant_id: tenantId, plan_id: plan.id, status, assigned_by: actorId, reason }).select('id, plan_id, status, started_at').single();
  if (insertError) throw new Error(insertError.message);
  const { error: auditError } = await db.from('tenant_entitlement_audit').insert({
    tenant_id: tenantId,
    action: 'subscription_changed',
    before_state: current,
    after_state: { subscription, plan: { key: plan.key, version: plan.version } },
    actor_id: actorId,
    reason,
    request_id: requestId || null,
  });
  if (auditError) throw new Error(auditError.message);
  await disableFinancialModuleByDefault(tenantId, actorId);
  return subscription;
}

export async function createTenantFeatureOverride({ tenantId, featureId, enabled, limitValue, config, expiresAt, actorId, reason, requestId }: {
  tenantId: string;
  featureId: string;
  enabled?: boolean | null;
  limitValue?: number | null;
  config?: Record<string, unknown>;
  expiresAt?: string | null;
  actorId: string;
  reason: string;
  requestId?: string;
}) {
  if (!reason.trim()) throw new Error('Informe o motivo do override.');
  if (limitValue !== undefined && limitValue !== null && (!Number.isInteger(limitValue) || limitValue < 0)) throw new Error('O limite precisa ser um inteiro maior ou igual a zero.');
  if (expiresAt && Number.isNaN(Date.parse(expiresAt))) throw new Error('Data de expiração inválida.');
  if (expiresAt && Date.parse(expiresAt) <= Date.now()) throw new Error('A expiração do override precisa estar no futuro.');
  const db = getPlatformDb();
  const { data: feature, error: featureError } = await db.from('features').select('id, key').eq('id', featureId).eq('status', 'active').maybeSingle();
  if (featureError) throw new Error(featureError.message);
  if (!feature) throw new Error('Feature ativa não encontrada.');
  const { data: override, error } = await db.from('tenant_feature_overrides').insert({
    tenant_id: tenantId,
    feature_id: featureId,
    enabled: enabled ?? null,
    limit_value: limitValue ?? null,
    config: config || {},
    reason,
    expires_at: expiresAt || null,
    created_by: actorId,
    request_id: requestId || null,
  }).select('id, feature_id, enabled, limit_value, config, expires_at, reason, created_at').single();
  if (error) throw new Error(error.message);
  const { error: auditError } = await db.from('tenant_entitlement_audit').insert({
    tenant_id: tenantId,
    feature_id: featureId,
    action: 'override_created',
    after_state: override,
    actor_id: actorId,
    reason,
    request_id: requestId || null,
  });
  if (auditError) throw new Error(auditError.message);
  return override;
}

export async function revokeTenantFeatureOverride({ tenantId, overrideId, actorId, reason, requestId }: { tenantId: string; overrideId: string; actorId: string; reason: string; requestId?: string }) {
  if (!reason.trim()) throw new Error('Informe o motivo da revogação.');
  const db = getPlatformDb();
  const { data: current, error: currentError } = await db.from('tenant_feature_overrides').select('id, feature_id, enabled, limit_value, config, expires_at, reason').eq('id', overrideId).eq('tenant_id', tenantId).is('revoked_at', null).maybeSingle();
  if (currentError) throw new Error(currentError.message);
  if (!current) throw new Error('Override ativo não encontrado.');
  const { error: updateError } = await db.from('tenant_feature_overrides').update({ revoked_at: new Date().toISOString(), revoked_by: actorId }).eq('id', overrideId).eq('tenant_id', tenantId);
  if (updateError) throw new Error(updateError.message);
  const { error: auditError } = await db.from('tenant_entitlement_audit').insert({
    tenant_id: tenantId,
    feature_id: current.feature_id,
    action: 'override_revoked',
    before_state: current,
    after_state: { revokedAt: new Date().toISOString() },
    actor_id: actorId,
    reason,
    request_id: requestId || null,
  });
  if (auditError) throw new Error(auditError.message);
}
