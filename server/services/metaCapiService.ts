/**
 * Meta Conversions API — parte reutilizável por serviços internos (não só
 * pela rota HTTP do painel). Separado de `server/routes/metaCapi.ts` pra
 * evitar que services importem de routes (inversão de camada) — o disparo
 * automático no fechamento de agendamento (Epic 4.5.6, autoReply.ts) mora
 * na camada de service, igual todo o resto do domínio.
 */
import crypto from 'crypto';
import { getDb } from './db';

const META_GRAPH_VERSION = 'v21.0';

/** SHA-256 de um campo de user_data, normalizado como a Meta exige (minúsculo, sem espaço nas pontas). */
export function hashUserDataField(value: string): string {
  return crypto.createHash('sha256').update(value.trim().toLowerCase()).digest('hex');
}

/** Telefone só com dígitos (código do país incluso, sem "+"/espaços/traços) — formato exigido pela Meta pro campo "ph" antes do hash. */
export function normalizePhoneForHash(phone: string): string {
  return phone.replace(/\D/g, '');
}

interface TenantCapiCredentials {
  datasetId: string;
  accessToken: string;
  pageId: string;
}

async function getTenantCapiCredentials(tenantId: string): Promise<TenantCapiCredentials | null> {
  const db = getDb();
  const { data } = await db
    .from('tenant_meta_credentials')
    .select('capi_dataset_id, capi_access_token, capi_page_id')
    .eq('tenant_id', tenantId)
    .maybeSingle();
  if (!data?.capi_dataset_id || !data?.capi_access_token || !data?.capi_page_id) return null;
  return { datasetId: data.capi_dataset_id, accessToken: data.capi_access_token, pageId: data.capi_page_id };
}

/**
 * Dispara um evento de conversão real pro Meta CAPI amarrado ao anúncio que
 * originou a conversa (Epic 4.5.6) — chamado automaticamente quando o
 * agente cria um agendamento de verdade (`autoReply.ts`), sem precisar do
 * operador clicar em nada no painel.
 *
 * Duas guardas que nunca abrem exceção: sem credencial de CAPI configurada
 * pro tenant (`tenant_meta_credentials.capi_*`), não dispara — silencioso,
 * não é erro, a maioria dos tenants não vai ter isso configurado ainda.
 * Sem `ctwaClid` (a conversa não veio de um anúncio Clique-para-WhatsApp),
 * também não dispara — nunca manda um evento de atribuição incompleta/
 * inventada pra Meta.
 *
 * Fire-and-forget por natureza (chamador nunca deve `await` isso no
 * caminho crítico de criar o agendamento) — falha aqui nunca pode impedir
 * a confirmação real pro cliente.
 */
export async function fireMetaCapiEventForTenant(
  tenantId: string,
  params: { eventName: string; phone: string; ctwaClid?: string | null; value?: number; contentName?: string }
): Promise<void> {
  if (!params.ctwaClid) return;
  const creds = await getTenantCapiCredentials(tenantId);
  if (!creds) return;

  const phoneHash = hashUserDataField(normalizePhoneForHash(params.phone));
  const payload = {
    data: [
      {
        event_name: params.eventName,
        event_time: Math.floor(Date.now() / 1000),
        action_source: 'business_messaging',
        messaging_channel: 'whatsapp',
        user_data: { ph: [phoneHash], page_id: creds.pageId, ctwa_clid: params.ctwaClid },
        custom_data: {
          currency: 'PYG',
          ...(params.contentName ? { content_name: params.contentName } : {}),
          ...(params.value !== undefined ? { value: params.value } : {}),
        },
      },
    ],
  };

  try {
    const res = await fetch(`https://graph.facebook.com/${META_GRAPH_VERSION}/${encodeURIComponent(creds.datasetId)}/events?access_token=${encodeURIComponent(creds.accessToken)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data: any = await res.json().catch(() => ({}));
    if (!res.ok) {
      console.error(`[Meta CAPI] tenant=${tenantId} falha ao disparar "${params.eventName}":`, data?.error?.message || res.status);
    } else {
      console.log(`[Meta CAPI] tenant=${tenantId} evento "${params.eventName}" disparado (${data.events_received ?? 0} recebido(s) pela Meta).`);
    }
  } catch (err: any) {
    console.error(`[Meta CAPI] tenant=${tenantId} erro ao chamar a Meta:`, err.message);
  }
}
