/**
 * Issue #111 — alerta (push + WhatsApp) quando um erro real de sistema
 * acontece (unhandledRejection/uncaughtException/rota 500), sem depender de
 * nenhum serviço externo. Cobre: avisa todos os tenants com admin_alert_phone
 * configurado; tenant sem admin_alert_phone não quebra os outros; cooldown
 * evita rajada de alertas duplicados; falha no envio não derruba nada.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { initDb } from '../db';
import { createFakeSupabase } from './fakeSupabase';

const sendWhatsAppTemplateMessage = vi.fn(async () => undefined);
vi.mock('../metaSend', () => ({ sendWhatsAppTemplateMessage }));

const sendEvolutionTextMessage = vi.fn(async () => 'wamid-evo');
vi.mock('../evolutionSend', () => ({ sendEvolutionTextMessage }));

const resolveCredentialsForTenant = vi.fn(async (): Promise<Record<string, any>> => ({ provider: 'meta', metaAccessToken: 'tok', metaPhoneNumberId: 'pn' }));
vi.mock('../tenantResolver', () => ({ resolveCredentialsForTenant }));

const { notifySystemError, resetSystemErrorAlertCooldownForTests } = await import('../systemErrorAlertService');

const TENANT_A = '11111111-1111-1111-1111-111111111111';
const TENANT_B = '22222222-2222-2222-2222-222222222222';

beforeEach(() => {
  vi.clearAllMocks();
  resetSystemErrorAlertCooldownForTests();
});

describe('notifySystemError', () => {
  it('avisa todos os tenants com admin_alert_phone configurado', async () => {
    initDb(createFakeSupabase({
      tenants: [
        { id: TENANT_A, name: 'Monique', admin_alert_phone: '595990000000' },
        { id: TENANT_B, name: 'Bella Vita', admin_alert_phone: '595990001111' },
      ],
    }));

    await notifySystemError({ source: 'uncaughtException', message: 'TypeError: x is not a function' });

    expect(sendWhatsAppTemplateMessage).toHaveBeenCalledTimes(2);
    const targets = sendWhatsAppTemplateMessage.mock.calls.map((c: any[]) => c[2]).sort();
    expect(targets).toEqual(['595990000000', '595990001111']);
    const [, , , templateName, , params] = sendWhatsAppTemplateMessage.mock.calls[0] as any[];
    expect(templateName).toBe('sistema_erro_alerta');
    expect(params[0]).toBe('uncaughtException');
    expect(params[1]).toContain('TypeError');
  });

  it('tenant sem admin_alert_phone não recebe WhatsApp, mas não quebra os outros', async () => {
    initDb(createFakeSupabase({
      tenants: [
        { id: TENANT_A, name: 'Sem alerta configurado' },
        { id: TENANT_B, name: 'Bella Vita', admin_alert_phone: '595990001111' },
      ],
    }));

    await notifySystemError({ source: 'unhandledRejection', message: 'erro qualquer' });

    expect(sendWhatsAppTemplateMessage).toHaveBeenCalledTimes(1);
    expect((sendWhatsAppTemplateMessage.mock.calls[0] as any[])[2]).toBe('595990001111');
  });

  it('cooldown: uma segunda chamada logo em seguida não dispara alerta de novo', async () => {
    initDb(createFakeSupabase({ tenants: [{ id: TENANT_A, name: 'Monique', admin_alert_phone: '595990000000' }] }));

    await notifySystemError({ source: 'a', message: 'primeiro erro' }, 15 * 60 * 1000);
    await notifySystemError({ source: 'b', message: 'segundo erro logo depois' }, 15 * 60 * 1000);

    expect(sendWhatsAppTemplateMessage).toHaveBeenCalledTimes(1);
  });

  it('depois do cooldown passar, um novo erro alerta de novo', async () => {
    initDb(createFakeSupabase({ tenants: [{ id: TENANT_A, name: 'Monique', admin_alert_phone: '595990000000' }] }));

    await notifySystemError({ source: 'a', message: 'primeiro erro' }, 0); // cooldown 0 — sempre passa
    await notifySystemError({ source: 'b', message: 'segundo erro' }, 0);

    expect(sendWhatsAppTemplateMessage).toHaveBeenCalledTimes(2);
  });

  it('nunca lança, mesmo se o envio falhar', async () => {
    initDb(createFakeSupabase({ tenants: [{ id: TENANT_A, name: 'Monique', admin_alert_phone: '595990000000' }] }));
    sendWhatsAppTemplateMessage.mockRejectedValueOnce(new Error('template não aprovado ainda'));

    await expect(notifySystemError({ source: 'a', message: 'erro qualquer' })).resolves.toBeUndefined();
  });

  it('tenant cujo canal real é Evolution API recebe o alerta por texto livre, não por template Meta (issue #290)', async () => {
    initDb(createFakeSupabase({ tenants: [{ id: TENANT_A, name: 'Monique', admin_alert_phone: '595990000000' }] }));
    resolveCredentialsForTenant.mockResolvedValueOnce({
      provider: 'evolution',
      evolutionInstanceName: 'inst-monique',
      evolutionApiUrl: 'https://evo.example.com',
      evolutionApiKey: 'evo-key',
    });

    await notifySystemError({ source: 'uncaughtException', message: 'TypeError: x is not a function' });

    expect(sendEvolutionTextMessage).toHaveBeenCalledTimes(1);
    const [instanceName, apiUrl, apiKey, to, text] = sendEvolutionTextMessage.mock.calls[0] as any[];
    expect(instanceName).toBe('inst-monique');
    expect(apiUrl).toBe('https://evo.example.com');
    expect(apiKey).toBe('evo-key');
    expect(to).toBe('595990000000');
    expect(text).toContain('uncaughtException');
    expect(sendWhatsAppTemplateMessage).not.toHaveBeenCalled();
  });
});
