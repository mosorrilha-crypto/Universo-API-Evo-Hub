/**
 * Envio de Web Push (issue #159) — segundo canal de alerta pro operador via
 * PWA instalado no celular. Sem VAPID configurado vira no-op silencioso;
 * assinatura morta (404/410) é removida pra não tentar de novo pra sempre.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';

const sendNotification = vi.fn(async () => undefined);
const setVapidDetails = vi.fn();
vi.mock('web-push', () => ({ default: { setVapidDetails, sendNotification } }));

const listSubscriptionsForTenant = vi.fn(async () => [] as any[]);
const removeSubscriptionByEndpoint = vi.fn(async () => undefined);
vi.mock('../pushSubscriptionStore', () => ({ listSubscriptionsForTenant, removeSubscriptionByEndpoint }));

const { initWebPush, sendPushToTenant } = await import('../webPush');

const TENANT_A = '11111111-1111-1111-1111-111111111111';
const subA = { endpoint: 'https://push.example/a', keys: { p256dh: 'p256dh-a', auth: 'auth-a' } };
const subB = { endpoint: 'https://push.example/b', keys: { p256dh: 'p256dh-b', auth: 'auth-b' } };

beforeEach(() => {
  vi.clearAllMocks();
  listSubscriptionsForTenant.mockResolvedValue([]);
});

describe('sendPushToTenant sem VAPID configurado', () => {
  it('não tenta enviar nada (no-op silencioso)', async () => {
    // initWebPush nunca foi chamado com chaves válidas neste describe.
    await sendPushToTenant(TENANT_A, { title: 'Título', body: 'Corpo' });
    expect(sendNotification).not.toHaveBeenCalled();
  });
});

describe('sendPushToTenant com VAPID configurado', () => {
  beforeEach(() => {
    initWebPush({ vapidPublicKey: 'pub', vapidPrivateKey: 'priv', vapidSubject: 'mailto:teste@universo.ai' });
  });

  it('envia a mesma notificação pra todos os dispositivos inscritos do tenant', async () => {
    listSubscriptionsForTenant.mockResolvedValueOnce([subA, subB]);

    await sendPushToTenant(TENANT_A, { title: '🚨 Nova escalação', body: 'Cliente Teste — motivo qualquer' });

    expect(sendNotification).toHaveBeenCalledTimes(2);
    const bodies = sendNotification.mock.calls.map((call: any[]) => JSON.parse(call[1]));
    expect(bodies).toEqual([
      { title: '🚨 Nova escalação', body: 'Cliente Teste — motivo qualquer' },
      { title: '🚨 Nova escalação', body: 'Cliente Teste — motivo qualquer' },
    ]);
  });

  it('remove a assinatura quando o navegador confirma que não existe mais (410 Gone)', async () => {
    listSubscriptionsForTenant.mockResolvedValueOnce([subA]);
    sendNotification.mockRejectedValueOnce(Object.assign(new Error('gone'), { statusCode: 410 }));

    await sendPushToTenant(TENANT_A, { title: 't', body: 'b' });

    expect(removeSubscriptionByEndpoint).toHaveBeenCalledWith('https://push.example/a');
  });

  it('não remove a assinatura pra outros tipos de erro (ex: falha transitória de rede)', async () => {
    listSubscriptionsForTenant.mockResolvedValueOnce([subA]);
    sendNotification.mockRejectedValueOnce(new Error('network timeout'));

    await sendPushToTenant(TENANT_A, { title: 't', body: 'b' });

    expect(removeSubscriptionByEndpoint).not.toHaveBeenCalled();
  });

  it('não lança mesmo se listar assinaturas falhar', async () => {
    listSubscriptionsForTenant.mockRejectedValueOnce(new Error('db indisponível'));

    await expect(sendPushToTenant(TENANT_A, { title: 't', body: 'b' })).resolves.toBeUndefined();
  });
});
