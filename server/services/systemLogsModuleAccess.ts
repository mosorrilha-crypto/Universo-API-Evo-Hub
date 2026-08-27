import { getTenantEntitlements } from './featureEntitlementService';

/** Recurso novo: por padrão só SaaS Admin vê; o tenant recebe acesso via override explícito. */
export const SYSTEM_LOGS_MODULE_FEATURE_KEY = 'operations.system_logs';

export async function isSystemLogsModuleEnabledForCurrentTenant(): Promise<boolean> {
  try {
    const { entitlements } = await getTenantEntitlements();
    return entitlements.some((entitlement) => entitlement.key === SYSTEM_LOGS_MODULE_FEATURE_KEY && entitlement.enabled);
  } catch (error) {
    console.warn('⚠️ [Logs do Sistema] Não foi possível resolver o entitlement do tenant; módulo mantido desabilitado.', (error as Error)?.message || error);
    return false;
  }
}
