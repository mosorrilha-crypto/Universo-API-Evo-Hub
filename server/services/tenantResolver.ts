/**
 * Bloco 2.B — resolve qual tenant é dono de um número de WhatsApp
 * (phone_number_id da Meta) assim que uma mensagem chega, e qual credencial
 * usar pra responder por esse número.
 *
 * Regra de fallback (revisada após revisão de segurança de 06/08/2026 — ver
 * `docs/AGENTE-VERTICAL-ARQUITETURA.md`, seção "Isolamento e riscos"):
 *   - phone_number_id bate com `tenant_meta_credentials` → esse tenant.
 *   - phone_number_id ausente, ou igual ao número compartilhado configurado
 *     (META_PHONE_NUMBER_ID) → tenant legado (Monique), que é o dono real
 *     desse número hoje.
 *   - phone_number_id presente mas não bate com nenhum tenant conhecido nem
 *     com o número compartilhado → **canal desconhecido**. Antes disso caía
 *     silenciosamente no tenant legado (risco real de vazamento cross-tenant
 *     assim que um segundo cliente existir); agora retorna `unknownChannel:
 *     true` e nenhum dado é gravado em tenant nenhum — quem chama decide
 *     descartar e logar pra investigação manual.
 */
import { getDb } from './db';
import { LEGACY_DEFAULT_TENANT_ID } from './tenantContext';

export interface ResolvedTenant {
  tenantId: string;
  metaAccessToken?: string;
  metaPhoneNumberId?: string;
  /** true quando o phone_number_id não bate com nenhum tenant cadastrado nem com o número compartilhado — não escrever em nenhum tenant. */
  unknownChannel?: boolean;
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
      console.warn('⚠️  [Tenant] Falha ao resolver tenant por phone_number_id:', (err as Error).message);
      return { tenantId: '', unknownChannel: true };
    }
    if (shared.metaPhoneNumberId && phoneNumberId !== shared.metaPhoneNumberId) {
      console.warn(`🚫 [Tenant] phone_number_id "${phoneNumberId}" não pertence a nenhum tenant cadastrado nem ao número compartilhado — mensagem descartada como canal desconhecido, não gravada em tenant nenhum.`);
      return { tenantId: '', unknownChannel: true };
    }
  }
  return { tenantId: LEGACY_DEFAULT_TENANT_ID, metaAccessToken: shared.metaAccessToken, metaPhoneNumberId: shared.metaPhoneNumberId };
}

/**
 * Busca reversa: dado um tenantId (ex: iterando tenants no job de lembretes,
 * Bloco 2.C), resolve a credencial Meta pra enviar mensagem em nome dele. Cai
 * na credencial compartilhada se o tenant não tiver `tenant_meta_credentials`
 * cadastrada ainda (ex: o tenant legado, que nunca passou pelo onboarding
 * manual de scripts/create-tenant.ts).
 */
export async function resolveMetaCredentialsForTenant(
  tenantId: string,
  shared: SharedMetaCredentials
): Promise<SharedMetaCredentials> {
  try {
    const db = getDb();
    const { data } = await db
      .from('tenant_meta_credentials')
      .select('access_token, phone_number_id')
      .eq('tenant_id', tenantId)
      .maybeSingle();
    if (data) {
      return {
        metaAccessToken: data.access_token || shared.metaAccessToken,
        metaPhoneNumberId: data.phone_number_id || shared.metaPhoneNumberId,
      };
    }
  } catch (err) {
    console.warn('⚠️  [Tenant] Falha ao resolver credencial Meta do tenant, usando credencial compartilhada:', (err as Error).message);
  }
  return shared;
}
