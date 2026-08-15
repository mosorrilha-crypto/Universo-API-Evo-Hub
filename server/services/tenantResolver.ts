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
  /** Porta A (Epic 4.6) — presente quando a mensagem/canal veio de uma instância Evolution API em vez do Meta Cloud API oficial. Instagram DM (Fase 1, 15/08/2026) — terceiro canal, mesma Meta App/webhook da Meta Cloud API, payload e credencial próprios (ver resolveTenantByInstagramAccountId). */
  provider?: 'meta' | 'evolution' | 'instagram';
  evolutionInstanceName?: string;
  evolutionApiUrl?: string;
  evolutionApiKey?: string;
  instagramAccountId?: string;
  instagramAccessToken?: string;
  /** true quando o phone_number_id não bate com nenhum tenant cadastrado nem com o número compartilhado — não escrever em nenhum tenant. */
  unknownChannel?: boolean;
}

export interface SharedMetaCredentials {
  metaAccessToken?: string;
  metaPhoneNumberId?: string;
}

export interface SharedEvolutionCredentials {
  evolutionInstanceName?: string;
  evolutionApiUrl?: string;
  evolutionApiKey?: string;
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
 * Epic 4.6 (Porta A — Evolution API, QR Code) — mesma lógica de
 * `resolveTenantByPhoneNumberId` acima, trocando `phone_number_id` da Meta
 * por `instance_name` da Evolution API (`tenant_evolution_credentials`,
 * migration 0011). Mesma regra de segurança do Bloco 2.B: instância presente
 * mas desconhecida nunca cai no tenant legado — descarta como canal
 * desconhecido.
 */
export async function resolveTenantByEvolutionInstance(
  instanceName: string | undefined,
  shared: SharedEvolutionCredentials
): Promise<ResolvedTenant> {
  if (instanceName) {
    try {
      const db = getDb();
      const { data } = await db
        .from('tenant_evolution_credentials')
        .select('tenant_id, instance_name, api_url, api_key')
        .eq('instance_name', instanceName)
        .maybeSingle();
      if (data) {
        return {
          tenantId: data.tenant_id,
          provider: 'evolution',
          evolutionInstanceName: data.instance_name,
          evolutionApiUrl: data.api_url || shared.evolutionApiUrl,
          evolutionApiKey: data.api_key || shared.evolutionApiKey,
        };
      }
    } catch (err) {
      console.warn('⚠️  [Tenant] Falha ao resolver tenant por instância Evolution:', (err as Error).message);
      return { tenantId: '', unknownChannel: true };
    }
    if (shared.evolutionInstanceName && instanceName !== shared.evolutionInstanceName) {
      console.warn(`🚫 [Tenant] Instância Evolution "${instanceName}" não pertence a nenhum tenant cadastrado nem à instância compartilhada — mensagem descartada como canal desconhecido, não gravada em tenant nenhum.`);
      return { tenantId: '', unknownChannel: true };
    }
  }
  return {
    tenantId: LEGACY_DEFAULT_TENANT_ID,
    provider: 'evolution',
    evolutionInstanceName: shared.evolutionInstanceName,
    evolutionApiUrl: shared.evolutionApiUrl,
    evolutionApiKey: shared.evolutionApiKey,
  };
}

/**
 * Instagram DM (Fase 1, 15/08/2026) — mesma lógica de
 * `resolveTenantByEvolutionInstance` acima, trocando `instance_name` pelo ID
 * da conta Instagram (`tenant_instagram_credentials`, migration 0033).
 * Diferente da Meta Cloud API e da Evolution, não existe tenant legado nem
 * credencial compartilhada aqui — é um canal novo, sem histórico anterior a
 * proteger — então uma conta desconhecida sempre descarta como canal
 * desconhecido, sem fallback nenhum.
 */
export async function resolveTenantByInstagramAccountId(instagramAccountId: string | undefined): Promise<ResolvedTenant> {
  if (!instagramAccountId) return { tenantId: '', unknownChannel: true };
  try {
    const db = getDb();
    const { data } = await db
      .from('tenant_instagram_credentials')
      .select('tenant_id, instagram_account_id, access_token')
      .eq('instagram_account_id', instagramAccountId)
      .maybeSingle();
    if (data) {
      return {
        tenantId: data.tenant_id,
        provider: 'instagram',
        instagramAccountId: data.instagram_account_id,
        instagramAccessToken: data.access_token,
      };
    }
  } catch (err) {
    console.warn('⚠️  [Tenant] Falha ao resolver tenant por conta Instagram:', (err as Error).message);
    return { tenantId: '', unknownChannel: true };
  }
  console.warn(`🚫 [Tenant] Conta Instagram "${instagramAccountId}" não pertence a nenhum tenant cadastrado — mensagem descartada como canal desconhecido, não gravada em tenant nenhum.`);
  return { tenantId: '', unknownChannel: true };
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

/**
 * Busca completa: resolve qual provedor e quais credenciais usar para um tenant específico.
 * Tenta Evolution primeiro, depois Meta (específica), e cai na Meta compartilhada se nada existir.
 */
export async function resolveCredentialsForTenant(
  tenantId: string,
  sharedMeta: SharedMetaCredentials,
  sharedEvo: SharedEvolutionCredentials
): Promise<ResolvedTenant> {
  try {
    const db = getDb();
    
    // Tenta Evolution primeiro (Porta A)
    const { data: evo } = await db
      .from('tenant_evolution_credentials')
      .select('instance_name, api_url, api_key')
      .eq('tenant_id', tenantId)
      .maybeSingle();
    
    if (evo) {
      return {
        tenantId,
        provider: 'evolution',
        evolutionInstanceName: evo.instance_name,
        evolutionApiUrl: evo.api_url || sharedEvo.evolutionApiUrl,
        evolutionApiKey: evo.api_key || sharedEvo.evolutionApiKey,
      };
    }

    // Tenta Meta específica
    const { data: meta } = await db
      .from('tenant_meta_credentials')
      .select('access_token, phone_number_id')
      .eq('tenant_id', tenantId)
      .maybeSingle();
    
    if (meta) {
      return {
        tenantId,
        provider: 'meta',
        metaAccessToken: meta.access_token || sharedMeta.metaAccessToken,
        metaPhoneNumberId: meta.phone_number_id || sharedMeta.metaPhoneNumberId,
      };
    }
  } catch (err) {
    console.warn('⚠️  [Tenant] Falha ao resolver credenciais completas, usando fallback Meta:', (err as Error).message);
  }

  // Fallback para Meta compartilhada
  return {
    tenantId,
    provider: 'meta',
    metaAccessToken: sharedMeta.metaAccessToken,
    metaPhoneNumberId: sharedMeta.metaPhoneNumberId,
  };
}
