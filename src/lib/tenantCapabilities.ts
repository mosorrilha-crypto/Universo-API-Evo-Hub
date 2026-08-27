export const TENANT_NAVIGATION_FEATURES = {
  conversations: 'inbox.conversations',
  crm: 'crm.follow_ups',
  agenda: 'booking.calendar',
  financial: 'sales.financial',
  growth: 'growth.meta_ads',
  agent: 'ai.auto_reply',
  catalog: 'catalog.public_page',
  quality: 'quality.agent_review',
} as const;

export type TenantNavigationCapability = keyof typeof TENANT_NAVIGATION_FEATURES;

export type TenantEntitlement = {
  key?: string;
  enabled?: boolean;
};

export type TenantNavigationCapabilities = Record<TenantNavigationCapability, boolean>;

/**
 * Falha fechada: enquanto o contrato do tenant não foi carregado, nenhum
 * recurso opcional é apresentado como liberado. Assim, uma troca de empresa
 * por um saas_admin não deixa o menu do tenant anterior visível por engano.
 */
export const EMPTY_TENANT_NAVIGATION_CAPABILITIES: TenantNavigationCapabilities = {
  conversations: false,
  crm: false,
  agenda: false,
  financial: false,
  growth: false,
  agent: false,
  catalog: false,
  quality: false,
};

export function resolveTenantNavigationCapabilities(
  entitlements: readonly TenantEntitlement[] | null | undefined,
): TenantNavigationCapabilities {
  const enabledFeatures = new Set(
    (entitlements || [])
      .filter((entitlement) => entitlement.enabled)
      .map((entitlement) => entitlement.key),
  );

  return {
    conversations: enabledFeatures.has(TENANT_NAVIGATION_FEATURES.conversations),
    crm: enabledFeatures.has(TENANT_NAVIGATION_FEATURES.crm),
    agenda: enabledFeatures.has(TENANT_NAVIGATION_FEATURES.agenda),
    financial: enabledFeatures.has(TENANT_NAVIGATION_FEATURES.financial),
    growth: enabledFeatures.has(TENANT_NAVIGATION_FEATURES.growth),
    agent: enabledFeatures.has(TENANT_NAVIGATION_FEATURES.agent),
    catalog: enabledFeatures.has(TENANT_NAVIGATION_FEATURES.catalog),
    quality: enabledFeatures.has(TENANT_NAVIGATION_FEATURES.quality),
  };
}
