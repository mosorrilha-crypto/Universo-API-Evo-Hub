/**
 * Refinamento do benchmark de mercado: escalação nova avisa o operador
 * IMEDIATAMENTE (não só quando o agente inteiro está pausado, que já tinha
 * alerta via agentPausedAlertJob.ts) — cada 30s de atraso no handoff
 * aumenta o abandono do cliente em ~10%.
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

const { logEscalation } = await import('../escalationStore');

const TENANT_A = '11111111-1111-1111-1111-111111111111';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('logEscalation — alerta imediato pro operador', () => {
  it('avisa o admin_alert_phone do tenant assim que uma escalação é criada', async () => {
    initDb(createFakeSupabase({
      tenants: [{ id: TENANT_A, name: 'Monique Sorrilha Beauty Studio', admin_alert_phone: '595990000000' }],
    }));

    await logEscalation(TENANT_A, '595981234567', 'Cliente Teste', 'Cliente com reclamação — atendimento humano obrigatório', 'oi');
    // notifyEscalationCreated é fire-and-forget dentro de logEscalation — dá um tick pro microtask rodar.
    await new Promise((r) => setImmediate(r));

    expect(sendWhatsAppTemplateMessage).toHaveBeenCalledTimes(1);
    const [phoneNumberId, accessToken, to, templateName, , params] = sendWhatsAppTemplateMessage.mock.calls[0] as any[];
    expect(phoneNumberId).toBe('pn');
    expect(accessToken).toBe('tok');
    expect(to).toBe('595990000000');
    expect(templateName).toBe('escalonamento_alerta');
    expect(params).toEqual(['Monique Sorrilha Beauty Studio', 'Cliente Teste', 'Cliente com reclamação — atendimento humano obrigatório']);
  });

  it('não avisa ninguém (e não quebra) quando o tenant não tem admin_alert_phone configurado', async () => {
    initDb(createFakeSupabase({ tenants: [{ id: TENANT_A, name: 'Sem alerta configurado' }] }));

    const escalation = await logEscalation(TENANT_A, '595981234567', 'Cliente Teste', 'motivo qualquer');
    await new Promise((r) => setImmediate(r));

    expect(escalation.id).toBeTruthy();
    expect(sendWhatsAppTemplateMessage).not.toHaveBeenCalled();
  });

  it('registra a escalação normalmente mesmo se o envio do alerta falhar', async () => {
    initDb(createFakeSupabase({
      tenants: [{ id: TENANT_A, name: 'Monique', admin_alert_phone: '595990000000' }],
    }));
    sendWhatsAppTemplateMessage.mockRejectedValueOnce(new Error('template não aprovado ainda'));

    const escalation = await logEscalation(TENANT_A, '595981234567', 'Cliente Teste', 'motivo qualquer');
    await new Promise((r) => setImmediate(r));

    expect(escalation.id).toBeTruthy();
    expect(escalation.resolved).toBe(false);
  });

  it('tenant cujo canal real é Evolution API recebe o alerta por texto livre, não por template Meta (issue #290)', async () => {
    initDb(createFakeSupabase({
      tenants: [{ id: TENANT_A, name: 'Monique Sorrilha Beauty Studio', admin_alert_phone: '595990000000' }],
    }));
    resolveCredentialsForTenant.mockResolvedValueOnce({
      provider: 'evolution',
      evolutionInstanceName: 'inst-monique',
      evolutionApiUrl: 'https://evo.example.com',
      evolutionApiKey: 'evo-key',
    });

    await logEscalation(TENANT_A, '595981234567', 'Cliente Teste', 'Cliente com reclamação — atendimento humano obrigatório', 'oi');
    await new Promise((r) => setImmediate(r));

    expect(sendEvolutionTextMessage).toHaveBeenCalledTimes(1);
    const [instanceName, apiUrl, apiKey, to, text] = sendEvolutionTextMessage.mock.calls[0] as any[];
    expect(instanceName).toBe('inst-monique');
    expect(apiUrl).toBe('https://evo.example.com');
    expect(apiKey).toBe('evo-key');
    expect(to).toBe('595990000000');
    expect(text).toContain('Cliente Teste');
    expect(sendWhatsAppTemplateMessage).not.toHaveBeenCalled();
  });
});
