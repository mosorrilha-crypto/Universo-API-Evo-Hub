/**
 * Notificação push do PWA do atendente (issue #159) — segundo canal de
 * alerta pro operador (escalação nova, agente pausado com lead sem
 * resposta), junto do WhatsApp template já existente. Ver public/sw.js
 * (recebe/exibe a notificação) e server/routes/pushSubscriptions.ts
 * (endpoints consumidos aqui).
 */
import { apiFetch } from './apiClient';

export function isPushSupported(): boolean {
  return typeof navigator !== 'undefined' && 'serviceWorker' in navigator && typeof window !== 'undefined' && 'PushManager' in window;
}

/**
 * O serviço de push do navegador exige a chave VAPID em Uint8Array
 * (formato "applicationServerKey"), não a string base64url que o backend
 * devolve — conversão padrão recomendada pela própria documentação do
 * protocolo Web Push.
 */
function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; i++) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

export async function getExistingPushSubscription(): Promise<PushSubscription | null> {
  if (!isPushSupported()) return null;
  const registration = await navigator.serviceWorker.getRegistration();
  if (!registration) return null;
  return registration.pushManager.getSubscription();
}

export interface EnablePushResult {
  success: boolean;
  error?: string;
}

/**
 * Nunca lança — qualquer falha (permissão negada, subscribe() rejeitado
 * pelo navegador/OS, rede) vira { success: false, error }. Achado real
 * testando num Chromium headless: registration.pushManager.subscribe()
 * pode rejeitar com uma exceção fora dos casos "óbvios" já tratados acima
 * (permissão, suporte, servidor) — sem o try/catch em volta de tudo, essa
 * rejeição escapava como unhandled rejection e o operador ficava sem
 * nenhum feedback (botão só voltava do estado "Aguarde..." em silêncio).
 */
export async function enablePushNotifications(): Promise<EnablePushResult> {
  if (!isPushSupported()) {
    return { success: false, error: 'Este navegador não suporta notificação push (funciona no Chrome/Android; no iPhone, precisa instalar via "Adicionar à Tela de Início" primeiro).' };
  }

  try {
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') {
      return { success: false, error: 'Permissão de notificação negada — ative manualmente nas configurações do navegador pra tentar de novo.' };
    }

    const registration = await navigator.serviceWorker.register('/sw.js');
    await navigator.serviceWorker.ready;

    const keyRes = await apiFetch('/api/push/vapid-public-key');
    if (!keyRes.ok) {
      return { success: false, error: 'Servidor sem notificação push configurada ainda (fale com o suporte).' };
    }
    const { publicKey } = await keyRes.json();

    let subscription = await registration.pushManager.getSubscription();
    if (!subscription) {
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey),
      });
    }

    const subRes = await apiFetch('/api/push/subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ subscription: subscription.toJSON(), userAgent: navigator.userAgent }),
    });
    if (!subRes.ok) {
      return { success: false, error: 'Não foi possível salvar a assinatura no servidor — tente de novo.' };
    }

    return { success: true };
  } catch (err) {
    return { success: false, error: `Não foi possível ativar notificações neste dispositivo (${(err as Error).message || 'erro desconhecido'}).` };
  }
}

export async function disablePushNotifications(): Promise<void> {
  const subscription = await getExistingPushSubscription();
  if (!subscription) return;
  await apiFetch('/api/push/unsubscribe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ endpoint: subscription.endpoint }),
  }).catch(() => {
    // Segue removendo local mesmo se o backend não confirmar — próxima vez
    // que o operador tentar reativar, um endpoint novo é gerado do zero.
  });
  await subscription.unsubscribe();
}
