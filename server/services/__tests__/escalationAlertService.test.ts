/**
 * Refinamento do benchmark de mercado: escalação nova avisa o operador
 * IMEDIATAMENTE (não só quando o agente inteiro está pausado, que já tinha
 * alerta via agentPausedAlertJob.ts) — cada 30s de atraso no handoff
 * aumenta o abandono do cliente em ~10%.
 *
 * TASK-0298: o canal de WhatsApp pro admin_alert_phone foi removido — o
 * alerta virou só push pro PWA do atendente (fica "no sistema").
 *
 * TASK-0399 (12/09/2026): o WhatsApp volta, mas como escolha explícita por
 * tenant (`alert_preferences.escalation`/`.payment_pending`, default false)
 * — cobre aqui: default desligado preserva o comportamento da TASK-0298;
 * ligar explicitamente manda o template certo por `kind` (escalonamento
 * geral vs. pagamento pendente); push continua incondicional nos dois casos.
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

describe('logEscalation — alerta imediato pro operador (push sempre + WhatsApp opt-in)', () => {
  it('preferência default (não configurada): dispara o push, sem enviar WhatsApp pro admin_alert_phone', async () => {
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

  it('alert_preferences.escalation = true + admin_alert_phone: manda o template de escalonamento geral por WhatsApp', async () => {
    initDb(createFakeSupabase({
      tenants: [{ id: TENANT_A, name: 'Monique', admin_alert_phone: '595990000000', alert_preferences: { escalation: true } }],
    }));

    await logEscalation(TENANT_A, '595981234567', 'Cliente Teste', 'Reclamação grave', undefined, 'general');
    await new Promise((r) => setImmediate(r));

    expect(sendWhatsAppTemplateMessage).toHaveBeenCalledTimes(1);
    expect(sendWhatsAppTemplateMessage).toHaveBeenCalledWith('pn', 'tok', '595990000000', 'escalonamento_alerta', 'pt_BR', ['Monique', 'Cliente Teste', 'Reclamação grave']);
  });

  it('alert_preferences.payment_pending = true + admin_alert_phone: manda o template de pagamento pendente, não o de escalonamento', async () => {
    initDb(createFakeSupabase({
      tenants: [{ id: TENANT_A, name: 'Monique', admin_alert_phone: '595990000000', alert_preferences: { payment_pending: true } }],
    }));

    await logEscalation(TENANT_A, '595981234567', 'Cliente Teste', 'Pagamento pendente de verificação há 3h', undefined, 'payment_proof');
    await new Promise((r) => setImmediate(r));

    expect(sendWhatsAppTemplateMessage).toHaveBeenCalledTimes(1);
    expect(sendWhatsAppTemplateMessage).toHaveBeenCalledWith('pn', 'tok', '595990000000', 'pagamento_pendente_alerta', 'pt_BR', ['Monique', 'Cliente Teste', 'Pagamento pendente de verificação há 3h']);
  });

  it('alert_preferences.escalation = true mas kind payment_proof: usa a chave payment_pending, não escalation (fica desligado se só escalation estiver ligado)', async () => {
    initDb(createFakeSupabase({
      tenants: [{ id: TENANT_A, name: 'Monique', admin_alert_phone: '595990000000', alert_preferences: { escalation: true, payment_pending: false } }],
    }));

    await logEscalation(TENANT_A, '595981234567', 'Cliente Teste', 'Pagamento pendente', undefined, 'payment_proof');
    await new Promise((r) => setImmediate(r));

    expect(sendWhatsAppTemplateMessage).not.toHaveBeenCalled();
    expect(sendPushToTenant).toHaveBeenCalledTimes(1);
  });

  it('preferência ligada mas sem admin_alert_phone: sem WhatsApp, sem erro, push continua indo', async () => {
    initDb(createFakeSupabase({
      tenants: [{ id: TENANT_A, name: 'Sem telefone', alert_preferences: { escalation: true } }],
    }));

    await expect(logEscalation(TENANT_A, '595981234567', 'Cliente Teste', 'motivo qualquer')).resolves.toBeTruthy();
    await new Promise((r) => setImmediate(r));

    expect(sendWhatsAppTemplateMessage).not.toHaveBeenCalled();
    expect(sendPushToTenant).toHaveBeenCalledTimes(1);
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
