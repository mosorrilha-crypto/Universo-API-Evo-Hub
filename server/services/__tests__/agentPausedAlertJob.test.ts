/**
 * Issue #115 — job que alerta o operador quando o agente fica pausado tempo
 * demais com lead sem resposta acumulando. Cobre: alerta só depois do
 * threshold de tempo E só com lead sem resposta real; idempotência (não
 * duplica alerta pra mesma "sessão de pausa"); tenant sem admin_alert_phone
 * configurado não tenta enviar (não quebra o job pros outros tenants).
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { initDb, getDb } from '../db';
import { createFakeSupabase } from './fakeSupabase';
import { checkPausedAgentsAndAlert } from '../agentPausedAlertJob';

vi.mock('../metaSend', () => ({
  sendWhatsAppTemplateMessage: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../evolutionSend', () => ({
  sendEvolutionTextMessage: vi.fn().mockResolvedValue('wamid-evo'),
}));

import { sendWhatsAppTemplateMessage } from '../metaSend';
import { sendEvolutionTextMessage } from '../evolutionSend';

const TENANT_A = '11111111-1111-1111-1111-111111111111';
const NOW = new Date('2026-08-09T20:00:00Z');

function minutesAgo(min: number): string {
  return new Date(NOW.getTime() - min * 60 * 1000).toISOString();
}

async function seedTenant(overrides: { adminAlertPhone?: string } = {}) {
  const db = getDb();
  await db.from('tenants').insert({ id: TENANT_A, name: 'Monique', admin_alert_phone: overrides.adminAlertPhone });
}

async function seedPausedSince(minutesAgoValue: number) {
  const db = getDb();
  await db.from('agent_status').insert({ tenant_id: TENANT_A, status: 'paused', updated_at: minutesAgo(minutesAgoValue), paused_alert_sent_at: null });
}

async function seedConversationWithLastMessage(sender: 'lead' | 'agent', createdAtMinutesAgo: number) {
  const db = getDb();
  await db.from('conversations').insert({ id: 'conv-1', tenant_id: TENANT_A, phone: '595981111111', name: 'Cliente A' });
  await db.from('messages').insert({
    id: 'm1',
    tenant_id: TENANT_A,
    conversation_id: 'conv-1',
    sender,
    type: 'text',
    text: 'oi',
    created_at: minutesAgo(createdAtMinutesAgo),
  });
}

beforeEach(() => {
  initDb(createFakeSupabase());
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  vi.mocked(sendWhatsAppTemplateMessage).mockClear();
  vi.mocked(sendEvolutionTextMessage).mockClear();
});

describe('agentPausedAlertJob', () => {
  it('agente pausado há mais tempo que o threshold, com lead sem resposta, manda alerta e marca paused_alert_sent_at', async () => {
    await seedTenant({ adminAlertPhone: '5567998038466' });
    await seedPausedSince(35); // > 30min
    await seedConversationWithLastMessage('lead', 20); // mensagem chegou depois da pausa começar

    await checkPausedAgentsAndAlert({ metaAccessToken: 'tok', metaPhoneNumberId: 'pnid' });

    expect(sendWhatsAppTemplateMessage).toHaveBeenCalledTimes(1);
    expect(sendWhatsAppTemplateMessage).toHaveBeenCalledWith(
      'pnid',
      'tok',
      '5567998038466',
      'agente_pausado_alerta',
      'pt_BR',
      ['Monique', '35', 'Cliente A']
    );

    const { data } = await getDb().from('agent_status').select('paused_alert_sent_at').eq('tenant_id', TENANT_A).maybeSingle();
    expect(data?.paused_alert_sent_at).toBeTruthy();
  });

  it('agente pausado há menos tempo que o threshold ainda não alerta', async () => {
    await seedTenant({ adminAlertPhone: '5567998038466' });
    await seedPausedSince(10); // < 30min
    await seedConversationWithLastMessage('lead', 5);

    await checkPausedAgentsAndAlert({ metaAccessToken: 'tok', metaPhoneNumberId: 'pnid' });

    expect(sendWhatsAppTemplateMessage).not.toHaveBeenCalled();
  });

  it('agente pausado tempo suficiente mas SEM lead sem resposta (última mensagem é do agente) não alerta', async () => {
    await seedTenant({ adminAlertPhone: '5567998038466' });
    await seedPausedSince(35);
    await seedConversationWithLastMessage('agent', 20);

    await checkPausedAgentsAndAlert({ metaAccessToken: 'tok', metaPhoneNumberId: 'pnid' });

    expect(sendWhatsAppTemplateMessage).not.toHaveBeenCalled();
  });

  it('tenant sem admin_alert_phone configurado não tenta enviar nada (não quebra o job)', async () => {
    await seedTenant({});
    await seedPausedSince(35);
    await seedConversationWithLastMessage('lead', 20);

    await expect(checkPausedAgentsAndAlert({ metaAccessToken: 'tok', metaPhoneNumberId: 'pnid' })).resolves.not.toThrow();
    expect(sendWhatsAppTemplateMessage).not.toHaveBeenCalled();
  });

  it('rodar o job duas vezes seguidas NÃO duplica o alerta (idempotência por sessão de pausa)', async () => {
    await seedTenant({ adminAlertPhone: '5567998038466' });
    await seedPausedSince(35);
    await seedConversationWithLastMessage('lead', 20);

    await checkPausedAgentsAndAlert({ metaAccessToken: 'tok', metaPhoneNumberId: 'pnid' });
    await checkPausedAgentsAndAlert({ metaAccessToken: 'tok', metaPhoneNumberId: 'pnid' });

    expect(sendWhatsAppTemplateMessage).toHaveBeenCalledTimes(1);
  });

  it('threshold customizado (pauseThresholdMs) é respeitado', async () => {
    await seedTenant({ adminAlertPhone: '5567998038466' });
    await seedPausedSince(10);
    await seedConversationWithLastMessage('lead', 5);

    await checkPausedAgentsAndAlert({ metaAccessToken: 'tok', metaPhoneNumberId: 'pnid', pauseThresholdMs: 5 * 60 * 1000 });

    expect(sendWhatsAppTemplateMessage).toHaveBeenCalledTimes(1);
  });

  it('tenant cujo canal real é Evolution API recebe o alerta por texto livre, não por template Meta (issue #290)', async () => {
    await seedTenant({ adminAlertPhone: '5567998038466' });
    await seedPausedSince(35);
    await seedConversationWithLastMessage('lead', 20);
    await getDb().from('tenant_evolution_credentials').insert({
      tenant_id: TENANT_A,
      instance_name: 'inst-monique',
      api_url: 'https://evo.example.com',
      api_key: 'evo-key',
    });

    await checkPausedAgentsAndAlert({ metaAccessToken: 'tok', metaPhoneNumberId: 'pnid' });

    expect(sendEvolutionTextMessage).toHaveBeenCalledTimes(1);
    const [instanceName, apiUrl, apiKey, to, text] = vi.mocked(sendEvolutionTextMessage).mock.calls[0] as any[];
    expect(instanceName).toBe('inst-monique');
    expect(apiUrl).toBe('https://evo.example.com');
    expect(apiKey).toBe('evo-key');
    expect(to).toBe('5567998038466');
    expect(text).toContain('Monique');
    expect(sendWhatsAppTemplateMessage).not.toHaveBeenCalled();
  });
});
