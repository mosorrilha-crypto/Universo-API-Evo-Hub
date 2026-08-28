import { getTenantEntitlements } from './featureEntitlementService';

/** Qualidade do agente é liberada por tenant pelo SaaS Admin e falha fechada fora desse contrato. */
export const QUALITY_MODULE_FEATURE_KEY = 'quality.agent_review';

export async function isQualityModuleEnabledForCurrentTenant(): Promise<boolean> {
  try {
    const { entitlements } = await getTenantEntitlements();
    return entitlements.some((entitlement) => (
      entitlement.key === QUALITY_MODULE_FEATURE_KEY && entitlement.enabled
    ));
  } catch (error) {
    console.warn('⚠️ [Qualidade] Não foi possível resolver o entitlement do tenant; módulo mantido desabilitado.', (error as Error)?.message || error);
    return false;
  }
}
