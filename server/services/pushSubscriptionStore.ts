/**
 * Assinaturas de Web Push do PWA do atendente (issue #159) — uma linha por
 * dispositivo/navegador que autorizou notificação, não por operador (a
 * mesma pessoa pode ter celular + desktop instalados ao mesmo tempo). Ver
 * supabase/migrations/0018_push_subscriptions.sql.
 */
import { getDb } from './db';

export interface PushSubscriptionKeys {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

type PushSubscriptionRow = {
  id: string;
  tenant_id: string;
  operator_id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
};

/**
 * Grava (ou atualiza, se o endpoint já existir — reinstalar o PWA ou
 * reautorizar notificação gera o mesmo endpoint) a assinatura de um
 * operador autenticado.
 */
export async function saveSubscription(
  tenantId: string,
  operatorId: string,
  subscription: PushSubscriptionKeys,
  userAgent?: string
): Promise<void> {
  const db = getDb();
  const { error } = await db.from('push_subscriptions').upsert(
    {
      tenant_id: tenantId,
      operator_id: operatorId,
      endpoint: subscription.endpoint,
      p256dh: subscription.keys.p256dh,
      auth: subscription.keys.auth,
      user_agent: userAgent || null,
    },
    { onConflict: 'endpoint' }
  );
  if (error) throw error;
}

export async function removeSubscription(tenantId: string, endpoint: string): Promise<void> {
  const db = getDb();
  const { error } = await db.from('push_subscriptions').delete().eq('tenant_id', tenantId).eq('endpoint', endpoint);
  if (error) throw error;
}

/** Remove pelo endpoint sem exigir tenant — usado quando o serviço de push do navegador confirma que a assinatura não existe mais (410 Gone / 404), pra não ficar reenviando pra um endpoint morto pra sempre. */
export async function removeSubscriptionByEndpoint(endpoint: string): Promise<void> {
  const db = getDb();
  const { error } = await db.from('push_subscriptions').delete().eq('endpoint', endpoint);
  if (error) throw error;
}

export async function listSubscriptionsForTenant(tenantId: string): Promise<PushSubscriptionKeys[]> {
  const db = getDb();
  const { data, error } = await db.from('push_subscriptions').select('endpoint, p256dh, auth').eq('tenant_id', tenantId);
  if (error) throw error;
  return (data as Pick<PushSubscriptionRow, 'endpoint' | 'p256dh' | 'auth'>[]).map((row) => ({
    endpoint: row.endpoint,
    keys: { p256dh: row.p256dh, auth: row.auth },
  }));
}
