import { getTenantEntitlements } from './featureEntitlementService';

/**
 * A chave comercial do módulo Financeiro é `sales.financial`. A decisão é
 * sempre resolvida no contexto RLS do tenant corrente; a edição do direito é
 * exclusiva das rotas administrativas protegidas por `saas_admin`.
 */
export const FINANCIAL_MODULE_FEATURE_KEY = 'sales.financial';

export async function isFinancialModuleEnabledForCurrentTenant(): Promise<boolean> {
  try {
    const { entitlements } = await getTenantEntitlements();
    return entitlements.some((entitlement) => (
      entitlement.key === FINANCIAL_MODULE_FEATURE_KEY && entitlement.enabled
    ));
  } catch (error) {
    // Falha fechada: um tenant sem contrato legível continua operando Agenda,
    // mas nunca ganha acesso financeiro por acidente.
    console.warn('⚠️ [Financeiro] Não foi possível resolver o entitlement do tenant; módulo mantido desabilitado.', (error as Error)?.message || error);
    return false;
  }
}
