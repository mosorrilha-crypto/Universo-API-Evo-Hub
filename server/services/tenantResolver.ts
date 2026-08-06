/**
 * Bloco 2.B — resolve qual tenant é dono de um número de WhatsApp
 * (phone_number_id da Meta) assim que uma mensagem chega, e qual credencial
 * usar pra responder por esse número.
 *
 * Se o número não estiver cadastrado em `tenant_meta_credentials` (cliente
 * ainda não onboardado — ver scripts/create-tenant.ts), cai no tenant legado
 * + credencial compartilhada (modo "shared": nosso App da Meta, configurado
 * via META_ACCESS_TOKEN/META_PHONE_NUMBER_ID) — exatamente o comportamento
 * de hoje, preservado como fallback.
 */
import { getDb } from './db';
import { LEGACY_DEFAULT_TENANT_ID } from './tenantContext';

export interface ResolvedTenant {
  tenantId: string;
  metaAccessToken?: string;
  metaPhoneNumberId?: string;
}

export interface SharedMetaCredentials {
  metaAccessToken?: string;
  metaPhoneNumberId?: string;
}

export async function resolveTenantByPhoneNumberId(
  phoneNumberId: string | undefined,
  shared: SharedMetaCredentials
): Promise<ResolvedTenant> {
  if (phoneNumberId) {
    try {
      const db = getDb();
      const { data } = await db
        .from('tenant_meta_credentials')
        .select('tenant_id, access_token, phone_number_id')
        .eq('phone_number_id', phoneNumberId)
        .maybeSingle();
      if (data) {
        return {
          tenantId: data.tenant_id,
          metaAccessToken: data.access_token || shared.metaAccessToken,
          metaPhoneNumberId: data.phone_number_id,
        };
      }
    } catch (err) {
      console.warn('⚠️  [Tenant] Falha ao resolver tenant por phone_number_id, usando tenant legado:', (err as Error).message);
    }
  }
  return { tenantId: LEGACY_DEFAULT_TENANT_ID, metaAccessToken: shared.metaAccessToken, metaPhoneNumberId: shared.metaPhoneNumberId };
}
