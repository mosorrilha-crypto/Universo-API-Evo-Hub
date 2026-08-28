import { getTenantEntitlements } from './featureEntitlementService';

/** Agenda é liberada por tenant pelo SaaS Admin e falha fechada fora desse contrato. */
export const AGENDA_MODULE_FEATURE_KEY = 'booking.calendar';

export async function isAgendaModuleEnabledForCurrentTenant(): Promise<boolean> {
  try {
    const { entitlements } = await getTenantEntitlements();
    return entitlements.some((entitlement) => (
      entitlement.key === AGENDA_MODULE_FEATURE_KEY && entitlement.enabled
    ));
  } catch {
    // Não loga o erro original: evita risco de log injection a partir de uma
    // mensagem de erro que poderia carregar dado não confiável.
    console.warn('⚠️ [Agenda] Não foi possível resolver o entitlement do tenant; módulo mantido desabilitado.');
    return false;
  }
}
