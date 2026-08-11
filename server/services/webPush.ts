/**
 * Envio de Web Push (issue #159) — segundo canal de alerta pro operador,
 * junto do WhatsApp template já existente (agentPausedAlertJob.ts,
 * escalationAlertService.ts). Sem VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY
 * configuradas, initWebPush() não roda e todo envio vira no-op silencioso
 * (loga uma vez, não quebra o fluxo real que disparou o alerta).
 */
import webpush from 'web-push';
import { listSubscriptionsForTenant, removeSubscriptionByEndpoint, type PushSubscriptionKeys } from './pushSubscriptionStore';

export interface PushPayload {
  title: string;
  body: string;
  /** Rota do painel pra abrir ao clicar na notificação (ex: '/'). */
  url?: string;
  /** Agrupa notificações relacionadas — o navegador substitui em vez de empilhar (ex: mesma conversa). */
  tag?: string;
}

let configured = false;
let warnedMissingKeys = false;

export function initWebPush(config: { vapidPublicKey?: string; vapidPrivateKey?: string; vapidSubject: string }): void {
  if (!config.vapidPublicKey || !config.vapidPrivateKey) return;
  webpush.setVapidDetails(config.vapidSubject, config.vapidPublicKey, config.vapidPrivateKey);
  configured = true;
}

/**
 * Manda a mesma notificação pra todos os dispositivos inscritos do tenant
 * (um operador pode ter mais de um). Nunca lança — cada assinatura falha
 * isoladamente; 404/410 (Gone) indica que o navegador cancelou a assinatura
 * de verdade, então a linha é removida pra não tentar de novo pra sempre.
 */
export async function sendPushToTenant(tenantId: string, payload: PushPayload): Promise<void> {
  if (!configured) {
    if (!warnedMissingKeys) {
      console.warn('⚠️  [Push] VAPID não configurado — notificação não enviada (configure VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY pra ativar).');
      warnedMissingKeys = true;
    }
    return;
  }

  let subscriptions: PushSubscriptionKeys[];
  try {
    subscriptions = await listSubscriptionsForTenant(tenantId);
  } catch (err) {
    console.warn(`⚠️  [Push] tenant=${tenantId} falha ao listar assinaturas:`, (err as Error).message);
    return;
  }
  if (subscriptions.length === 0) return;

  const body = JSON.stringify(payload);
  await Promise.all(
    subscriptions.map(async (sub) => {
      try {
        await webpush.sendNotification(sub, body);
      } catch (err: any) {
        if (err?.statusCode === 404 || err?.statusCode === 410) {
          await removeSubscriptionByEndpoint(sub.endpoint).catch(() => {});
        } else {
          console.warn(`⚠️  [Push] tenant=${tenantId} falha ao enviar pra um dispositivo:`, err?.message || err);
        }
      }
    })
  );
}
