import { getTenantEntitlements } from './featureEntitlementService';

/** Agenda é liberada por tenant pelo SaaS Admin e falha fechada fora desse contrato. */
export const AGENDA_MODULE_FEATURE_KEY = 'booking.calendar';

export async function isAgendaModuleEnabledForCurrentTenant(): Promise<boolean> {
  try {
    const { entitlements } = await getTenantEntitlements();
    return entitlements.some((entitlement) => (
      entitlement.key === AGENDA_MODULE_FEATURE_KEY && entitlement.enabled
    ));
  } catch (error) {
    console.warn('⚠️ [Agenda] Não foi possível resolver o entitlement do tenant; módulo mantido desabilitado.', (error as Error)?.message || error);
    return false;
  }
}
