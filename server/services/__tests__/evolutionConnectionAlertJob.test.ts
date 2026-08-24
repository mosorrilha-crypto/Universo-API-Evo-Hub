/**
 * Investigação real (24/08/2026, tenant Monique — Lucas Gimenes): sessão
 * Baileys/Evolution caiu sem ninguém ser avisado. Cobre: só alerta depois do
 * threshold (não no 1º tick de detecção, dá chance de blip curto); não alerta
 * de novo pro mesmo episódio (idempotência); reconectar limpa os marcadores,
 * permitindo alertar de novo numa queda futura; tenant sem admin_alert_phone
 * não quebra o job; falha ao consultar a Evolution API não conta como queda.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { initDb, getDb } from '../db';
import { createFakeSupabase } from './fakeSupabase';
import { checkEvolutionConnectionsAndAlert } from '../evolutionConnectionAlertJob';

vi.mock('../metaSend', () => ({
  sendWhatsAppTemplateMessage: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../webPush', () => ({
  sendPushToTenant: vi.fn().mockResolvedValue(undefined),
}));

import { sendWhatsAppTemplateMessage } from '../metaSend';
import { sendPushToTenant } from '../webPush';

const TENANT_A = '11111111-1111-1111-1111-111111111111';
const NOW = new Date('2026-08-24T12:00:00Z');

function minutesAgo(min: number): string {
  return new Date(NOW.getTime() - min * 60 * 1000).toISOString();
}

const fetchMock = vi.fn();

async function seedTenant(overrides: { adminAlertPhone?: string } = {}) {
  const db = getDb();
  await db.from('tenants').insert({ id: TENANT_A, name: 'Monique', admin_alert_phone: overrides.adminAlertPhone });
}

async function seedCredential(overrides: Partial<{ lastState: string | null; disconnectedSince: string | null; alertSentAt: string | null }> = {}) {
  const db = getDb();
  await db.from('tenant_evolution_credentials').insert({
    tenant_id: TENANT_A,
    instance_name: 'monique-abc123',
    api_url: 'https://evolution.example.com',
    api_key: 'evo-key',
    last_connection_state: overrides.lastState ?? 'open',
    disconnected_since: overrides.disconnectedSince ?? null,
    disconnected_alert_sent_at: overrides.alertSentAt ?? null,
  });
}

function mockConnectionState(state: string) {
  fetchMock.mockResolvedValue({ ok: true, json: async () => ({ instance: { state } }) });
}

beforeEach(() => {
  initDb(createFakeSupabase());
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  vi.mocked(sendWhatsAppTemplateMessage).mockClear();
  vi.mocked(sendPushToTenant).mockClear();
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

describe('evolutionConnectionAlertJob', () => {
  it('1ª detecção de queda só marca disconnected_since, ainda não alerta', async () => {
    await seedTenant({ adminAlertPhone: '5567998038466' });
    await seedCredential({ lastState: 'open' });
    mockConnectionState('close');

    await checkEvolutionConnectionsAndAlert({ metaAccessToken: 'tok', metaPhoneNumberId: 'pnid' });

    expect(sendWhatsAppTemplateMessage).not.toHaveBeenCalled();
    const { data } = await getDb().from('tenant_evolution_credentials').select('disconnected_since').eq('tenant_id', TENANT_A).maybeSingle();
    expect(data?.disconnected_since).toBeTruthy();
  });

  it('desconectado há mais tempo que o threshold alerta (push + WhatsApp) e marca disconnected_alert_sent_at', async () => {
    await seedTenant({ adminAlertPhone: '5567998038466' });
    await seedCredential({ lastState: 'close', disconnectedSince: minutesAgo(10) }); // > 5min padrão
    mockConnectionState('close');

    await checkEvolutionConnectionsAndAlert({ metaAccessToken: 'tok', metaPhoneNumberId: 'pnid' });

    expect(sendPushToTenant).toHaveBeenCalledTimes(1);
    expect(sendWhatsAppTemplateMessage).toHaveBeenCalledWith('pnid', 'tok', '5567998038466', 'whatsapp_desconectado_alerta', 'pt_BR', ['Monique', '10']);

    const { data } = await getDb().from('tenant_evolution_credentials').select('disconnected_alert_sent_at').eq('tenant_id', TENANT_A).maybeSingle();
    expect(data?.disconnected_alert_sent_at).toBeTruthy();
  });

  it('desconectado há menos tempo que o threshold ainda não alerta', async () => {
    await seedTenant({ adminAlertPhone: '5567998038466' });
    await seedCredential({ lastState: 'close', disconnectedSince: minutesAgo(2) }); // < 5min padrão
    mockConnectionState('close');

    await checkEvolutionConnectionsAndAlert({ metaAccessToken: 'tok', metaPhoneNumberId: 'pnid' });

    expect(sendWhatsAppTemplateMessage).not.toHaveBeenCalled();
  });

  it('rodar o job duas vezes seguidas NÃO duplica o alerta (idempotência por episódio de queda)', async () => {
    await seedTenant({ adminAlertPhone: '5567998038466' });
    await seedCredential({ lastState: 'close', disconnectedSince: minutesAgo(10) });
    mockConnectionState('close');

    await checkEvolutionConnectionsAndAlert({ metaAccessToken: 'tok', metaPhoneNumberId: 'pnid' });
    await checkEvolutionConnectionsAndAlert({ metaAccessToken: 'tok', metaPhoneNumberId: 'pnid' });

    expect(sendWhatsAppTemplateMessage).toHaveBeenCalledTimes(1);
  });

  it('reconectar limpa os marcadores, permitindo alertar de novo numa queda futura', async () => {
    await seedTenant({ adminAlertPhone: '5567998038466' });
    await seedCredential({ lastState: 'close', disconnectedSince: minutesAgo(10), alertSentAt: minutesAgo(9) });
    mockConnectionState('open');

    await checkEvolutionConnectionsAndAlert({ metaAccessToken: 'tok', metaPhoneNumberId: 'pnid' });

    const { data } = await getDb().from('tenant_evolution_credentials').select('disconnected_since, disconnected_alert_sent_at, last_connection_state').eq('tenant_id', TENANT_A).maybeSingle();
    expect(data?.disconnected_since).toBeNull();
    expect(data?.disconnected_alert_sent_at).toBeNull();
    expect(data?.last_connection_state).toBe('open');
    expect(sendWhatsAppTemplateMessage).not.toHaveBeenCalled();
  });

  it('tenant sem admin_alert_phone configurado só manda push, não quebra o job', async () => {
    await seedTenant({});
    await seedCredential({ lastState: 'close', disconnectedSince: minutesAgo(10) });
    mockConnectionState('close');

    await expect(checkEvolutionConnectionsAndAlert({ metaAccessToken: 'tok', metaPhoneNumberId: 'pnid' })).resolves.not.toThrow();
    expect(sendPushToTenant).toHaveBeenCalledTimes(1);
    expect(sendWhatsAppTemplateMessage).not.toHaveBeenCalled();
  });

  it('falha ao consultar a Evolution API não conta como queda nem quebra o job', async () => {
    await seedTenant({ adminAlertPhone: '5567998038466' });
    await seedCredential({ lastState: 'open' });
    fetchMock.mockRejectedValue(new Error('timeout'));

    await expect(checkEvolutionConnectionsAndAlert({ metaAccessToken: 'tok', metaPhoneNumberId: 'pnid' })).resolves.not.toThrow();
    expect(sendWhatsAppTemplateMessage).not.toHaveBeenCalled();
    const { data } = await getDb().from('tenant_evolution_credentials').select('disconnected_since').eq('tenant_id', TENANT_A).maybeSingle();
    expect(data?.disconnected_since).toBeFalsy();
  });
});
