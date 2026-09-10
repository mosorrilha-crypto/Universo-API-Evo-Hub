/**
 * Refinamento do benchmark de mercado: escalação nova avisa o operador
 * IMEDIATAMENTE (não só quando o agente inteiro está pausado, que já tinha
 * alerta via agentPausedAlertJob.ts) — cada 30s de atraso no handoff
 * aumenta o abandono do cliente em ~10%.
 *
 * TASK-0298: o canal de WhatsApp pro admin_alert_phone foi removido — o
 * alerta agora é só o push pro PWA do atendente (fica "no sistema").
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

const sendPushToTenant = vi.fn(async () => undefined);
vi.mock('../webPush', () => ({ sendPushToTenant }));

const { logEscalation } = await import('../escalationStore');

const TENANT_A = '11111111-1111-1111-1111-111111111111';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('logEscalation — alerta imediato pro operador (só no sistema)', () => {
  it('dispara o push pro painel assim que uma escalação é criada, sem enviar WhatsApp pro admin_alert_phone', async () => {
    initDb(createFakeSupabase({
      tenants: [{ id: TENANT_A, name: 'Monique Sorrilha Beauty Studio', admin_alert_phone: '595990000000' }],
    }));

    await logEscalation(TENANT_A, '595981234567', 'Cliente Teste', 'Cliente com reclamação — atendimento humano obrigatório', 'oi');
    // notifyEscalationCreated é fire-and-forget dentro de logEscalation — dá um tick pro microtask rodar.
    await new Promise((r) => setImmediate(r));

    expect(sendPushToTenant).toHaveBeenCalledTimes(1);
    const [tenantId, payload] = sendPushToTenant.mock.calls[0] as any[];
    expect(tenantId).toBe(TENANT_A);
    expect(payload.body).toContain('Cliente Teste');
    expect(payload.body).toContain('Cliente com reclamação — atendimento humano obrigatório');

    expect(sendWhatsAppTemplateMessage).not.toHaveBeenCalled();
    expect(sendEvolutionTextMessage).not.toHaveBeenCalled();
  });

  it('dispara o push mesmo quando o tenant não tem admin_alert_phone configurado', async () => {
    initDb(createFakeSupabase({ tenants: [{ id: TENANT_A, name: 'Sem alerta configurado' }] }));

    const escalation = await logEscalation(TENANT_A, '595981234567', 'Cliente Teste', 'motivo qualquer');
    await new Promise((r) => setImmediate(r));

    expect(escalation.id).toBeTruthy();
    expect(sendPushToTenant).toHaveBeenCalledTimes(1);
    expect(sendWhatsAppTemplateMessage).not.toHaveBeenCalled();
  });

  it('registra a escalação normalmente mesmo se o envio do push falhar', async () => {
    initDb(createFakeSupabase({
      tenants: [{ id: TENANT_A, name: 'Monique', admin_alert_phone: '595990000000' }],
    }));
    sendPushToTenant.mockRejectedValueOnce(new Error('assinatura inválida'));

    const escalation = await logEscalation(TENANT_A, '595981234567', 'Cliente Teste', 'motivo qualquer');
    await new Promise((r) => setImmediate(r));

    expect(escalation.id).toBeTruthy();
    expect(escalation.resolved).toBe(false);
  });

  it('não dispara um segundo push quando o mesmo caso do revisor reaparece com outro motivo', async () => {
    const db = createFakeSupabase({
      tenants: [{ id: TENANT_A, name: 'Monique', admin_alert_phone: '595990000000' }],
    });
    initDb(db);
    const sourceKey = 'revisor-pre-envio:595981234567';
    await logEscalation(TENANT_A, '595981234567', 'Cliente Teste', 'Revisor bloqueou por idioma', 'Mensagem A', 'general', { sourceKey });
    await new Promise((r) => setImmediate(r));
    await logEscalation(TENANT_A, '595981234567', 'Cliente Teste', 'Revisor bloqueou por agenda', 'Mensagem B', 'general', { sourceKey });
    await new Promise((r) => setImmediate(r));

    expect(sendPushToTenant).toHaveBeenCalledTimes(1);
    const row = db.__tables.escalations.find((item: any) => item.source_key === sourceKey);
    expect(row.occurrence_count).toBe(2);
    expect(row.reason).toContain('agenda');
  });
});
