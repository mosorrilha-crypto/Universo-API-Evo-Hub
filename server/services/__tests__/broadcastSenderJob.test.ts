/**
 * TASK-0171 — cobre a parte crítica de segurança do job: corte pelo
 * per_minute_cap/daily_cap/lote máximo por tick, o avanço adaptativo do
 * aquecimento (congela com qualidade ruim, nunca avança 2x no mesmo dia),
 * e que o job NUNCA sobrescreve o phone_number_id de uma conversa já
 * existente (a colisão de roteamento que motivou boa parte do desenho
 * desta feature).
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { initDb, getDb } from '../db';
import { createFakeSupabase } from './fakeSupabase';
import { runBroadcastSenderTick } from '../broadcastSenderJob';

vi.mock('../metaSend', () => ({
  sendWhatsAppTemplateMessage: vi.fn().mockResolvedValue({ messageId: 'wamid-test' }),
  uploadWhatsAppMedia: vi.fn().mockResolvedValue('media-id-test'),
}));
import { sendWhatsAppTemplateMessage, uploadWhatsAppMedia } from '../metaSend';

const TENANT_A = '11111111-1111-1111-1111-111111111111';
const NOW = new Date('2026-08-30T12:00:00Z');

async function seedTemplate(id: string, overrides: Partial<Record<string, any>> = {}) {
  await getDb().from('broadcast_templates').insert({
    id, tenant_id: TENANT_A, name: 't1', language: 'pt_BR', category: 'marketing',
    header_type: 'none', body_variable_labels: [], body_text: 'Oi {{nome}}!', ...overrides,
  });
}

async function seedNumber(id: string, overrides: Partial<Record<string, any>> = {}) {
  await getDb().from('broadcast_numbers').insert({
    id, tenant_id: TENANT_A, label: 'N1', phone_number_id: `pnid-${id}`, access_token: `tok-${id}`,
    status: 'active', warmup_progress_days: 0, warmup_last_advanced_on: null, quality_rating: 'high',
    per_minute_cap: 1000, daily_cap: 100000, min_gap_seconds: 0, ...overrides,
  });
}

async function seedCampaign(id: string, templateId: string, overrides: Partial<Record<string, any>> = {}) {
  await getDb().from('broadcast_campaigns').insert({
    id, tenant_id: TENANT_A, name: 'Campanha', template_id: templateId, contact_list_id: 'list-1',
    status: 'running', dedupe_window_days: 3, consent_confirmed: true, ...overrides,
  });
}

async function seedCampaignNumber(campaignId: string, numberId: string, allocationCount = 100) {
  await getDb().from('broadcast_campaign_numbers').insert({ campaign_id: campaignId, broadcast_number_id: numberId, allocation_count: allocationCount });
}

async function seedPendingRecipients(campaignId: string, numberId: string, count: number, phonePrefix = '5959800000') {
  for (let i = 0; i < count; i++) {
    const phone = `${phonePrefix}${i}`;
    await getDb().from('broadcast_contacts').insert({ id: `contact-${phone}`, tenant_id: TENANT_A, list_id: 'list-1', phone, name: `Contato ${i}`, variables: {} });
    await getDb().from('broadcast_campaign_recipients').insert({
      id: `recipient-${phone}`, campaign_id: campaignId, tenant_id: TENANT_A, contact_id: `contact-${phone}`,
      broadcast_number_id: numberId, phone, status: 'pending',
    });
  }
}

async function seedCampaignTemplateLink(campaignId: string, templateId: string, overrides: Partial<Record<string, any>> = {}) {
  await getDb().from('broadcast_campaign_templates').insert({ campaign_id: campaignId, template_id: templateId, header_media_id: null, ...overrides });
}

async function seedPendingRecipientWithTemplate(campaignId: string, numberId: string, phone: string, templateId: string) {
  await getDb().from('broadcast_contacts').insert({ id: `contact-${phone}`, tenant_id: TENANT_A, list_id: 'list-1', phone, name: `Contato ${phone}`, variables: {} });
  await getDb().from('broadcast_campaign_recipients').insert({
    id: `recipient-${phone}`, campaign_id: campaignId, tenant_id: TENANT_A, contact_id: `contact-${phone}`,
    broadcast_number_id: numberId, template_id: templateId, phone, status: 'pending',
  });
}

beforeEach(() => {
  initDb(createFakeSupabase());
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  vi.mocked(sendWhatsAppTemplateMessage).mockClear();
  vi.mocked(uploadWhatsAppMedia).mockClear();
});

describe('broadcastSenderJob — cotas de segurança', () => {
  it('respeita o per_minute_cap do número, mesmo com mais destinatários pendentes', async () => {
    await seedTemplate('tpl-1');
    await seedNumber('num-1', { per_minute_cap: 2, daily_cap: 100000 });
    await seedCampaign('camp-1', 'tpl-1');
    await seedCampaignNumber('camp-1', 'num-1');
    await seedPendingRecipients('camp-1', 'num-1', 5);

    await runBroadcastSenderTick();

    expect(sendWhatsAppTemplateMessage).toHaveBeenCalledTimes(2);
    const { data: pending } = await getDb().from('broadcast_campaign_recipients').select('id').eq('campaign_id', 'camp-1').eq('status', 'pending');
    expect(pending).toHaveLength(3);
  });

  it('respeita o daily_cap somando envios já feitos hoje (janela de 24h)', async () => {
    await seedTemplate('tpl-1');
    await seedNumber('num-1', { per_minute_cap: 1000, daily_cap: 3 });
    await seedCampaign('camp-1', 'tpl-1');
    await seedCampaignNumber('camp-1', 'num-1');
    // 2 já enviados nas últimas 24h (simulando envio anterior).
    await getDb().from('broadcast_campaign_recipients').insert([
      { id: 'r-already-1', campaign_id: 'camp-1', tenant_id: TENANT_A, contact_id: 'c-1', broadcast_number_id: 'num-1', phone: '595980000000', status: 'sent', sent_at: NOW.toISOString() },
      { id: 'r-already-2', campaign_id: 'camp-1', tenant_id: TENANT_A, contact_id: 'c-2', broadcast_number_id: 'num-1', phone: '595980000001', status: 'sent', sent_at: NOW.toISOString() },
    ]);
    await seedPendingRecipients('camp-1', 'num-1', 5, '5959899999');

    await runBroadcastSenderTick();

    // Só resta 1 de cota (3 - 2 já enviados).
    expect(sendWhatsAppTemplateMessage).toHaveBeenCalledTimes(1);
  });

  it('nunca processa mais que o lote máximo por tick (20), mesmo com cota alta disponível', async () => {
    await seedTemplate('tpl-1');
    await seedNumber('num-1', { per_minute_cap: 10000, daily_cap: 100000 });
    await seedCampaign('camp-1', 'tpl-1');
    await seedCampaignNumber('camp-1', 'num-1');
    await seedPendingRecipients('camp-1', 'num-1', 25);

    await runBroadcastSenderTick();

    expect(sendWhatsAppTemplateMessage).toHaveBeenCalledTimes(20);
  });

  it('número com quality_rating "low" não envia nada, mesmo com cota e pendentes disponíveis', async () => {
    await seedTemplate('tpl-1');
    await seedNumber('num-1', { quality_rating: 'low' });
    await seedCampaign('camp-1', 'tpl-1');
    await seedCampaignNumber('camp-1', 'num-1');
    await seedPendingRecipients('camp-1', 'num-1', 3);

    await runBroadcastSenderTick();

    expect(sendWhatsAppTemplateMessage).not.toHaveBeenCalled();
  });

  it('número banido/pausado não envia nada', async () => {
    await seedTemplate('tpl-1');
    await seedNumber('num-1', { status: 'banned' });
    await seedCampaign('camp-1', 'tpl-1');
    await seedCampaignNumber('camp-1', 'num-1');
    await seedPendingRecipients('camp-1', 'num-1', 3);

    await runBroadcastSenderTick();

    expect(sendWhatsAppTemplateMessage).not.toHaveBeenCalled();
  });
});

describe('broadcastSenderJob — aquecimento adaptativo', () => {
  it('avança o progresso de aquecimento 1x no dia quando a qualidade está Alta', async () => {
    await seedTemplate('tpl-1');
    await seedNumber('num-1', { status: 'warming', quality_rating: 'high', warmup_progress_days: 0, warmup_last_advanced_on: null, daily_cap: 1000 });
    await seedCampaign('camp-1', 'tpl-1');
    await seedCampaignNumber('camp-1', 'num-1');
    await seedPendingRecipients('camp-1', 'num-1', 1);

    await runBroadcastSenderTick();

    const { data: number } = await getDb().from('broadcast_numbers').select('*').eq('id', 'num-1').maybeSingle();
    expect(number.warmup_progress_days).toBe(1);
    expect(number.warmup_last_advanced_on).toBe('2026-08-30');
  });

  it('NUNCA avança 2x no mesmo dia, mesmo rodando o tick várias vezes', async () => {
    await seedTemplate('tpl-1');
    await seedNumber('num-1', { status: 'warming', quality_rating: 'high', warmup_progress_days: 0, warmup_last_advanced_on: null });
    await seedCampaign('camp-1', 'tpl-1');
    await seedCampaignNumber('camp-1', 'num-1');
    await seedPendingRecipients('camp-1', 'num-1', 3);

    await runBroadcastSenderTick();
    await runBroadcastSenderTick();

    const { data: number } = await getDb().from('broadcast_numbers').select('*').eq('id', 'num-1').maybeSingle();
    expect(number.warmup_progress_days).toBe(1);
  });

  it('qualidade Baixa/desconhecida CONGELA o progresso — não avança só porque passou o dia', async () => {
    await seedTemplate('tpl-1');
    await seedNumber('num-1', { status: 'warming', quality_rating: 'unknown', warmup_progress_days: 2, warmup_last_advanced_on: null });
    await seedCampaign('camp-1', 'tpl-1');
    await seedCampaignNumber('camp-1', 'num-1');
    await seedPendingRecipients('camp-1', 'num-1', 1);

    await runBroadcastSenderTick();

    const { data: number } = await getDb().from('broadcast_numbers').select('*').eq('id', 'num-1').maybeSingle();
    expect(number.warmup_progress_days).toBe(2);
  });

  it('promove sozinho pra "active" quando o patamar da curva já alcança o teto configurado', async () => {
    await seedTemplate('tpl-1');
    // patamar do dia 15 = 1000, igual ao daily_cap configurado -> sai do aquecimento.
    await seedNumber('num-1', { status: 'warming', quality_rating: 'high', warmup_progress_days: 14, warmup_last_advanced_on: null, daily_cap: 1000 });
    await seedCampaign('camp-1', 'tpl-1');
    await seedCampaignNumber('camp-1', 'num-1');
    await seedPendingRecipients('camp-1', 'num-1', 1);

    await runBroadcastSenderTick();

    const { data: number } = await getDb().from('broadcast_numbers').select('*').eq('id', 'num-1').maybeSingle();
    expect(number.warmup_progress_days).toBe(15);
    expect(number.status).toBe('active');
  });
});

describe('broadcastSenderJob — integração com o Atendimento', () => {
  it('envio bem-sucedido cria a conversation com o phone_number_id do número de disparo e grava sent_by=campaign', async () => {
    await seedTemplate('tpl-1', { body_variable_labels: [] });
    await seedNumber('num-1');
    await seedCampaign('camp-1', 'tpl-1');
    await seedCampaignNumber('camp-1', 'num-1');
    await seedPendingRecipients('camp-1', 'num-1', 1, '595987654321');

    await runBroadcastSenderTick();

    const { data: conv } = await getDb().from('conversations').select('*').eq('tenant_id', TENANT_A).eq('phone', '5959876543210').maybeSingle();
    expect(conv?.phone_number_id).toBe('pnid-num-1');

    const { data: messages } = await getDb().from('messages').select('*').eq('conversation_id', conv.id);
    expect(messages).toHaveLength(1);
    expect(messages![0].sent_by).toBe('campaign');
    expect(messages![0].sender).toBe('agent');

    const { data: recipient } = await getDb().from('broadcast_campaign_recipients').select('*').eq('phone', '5959876543210').maybeSingle();
    expect(recipient?.status).toBe('sent');
    expect(recipient?.wamid).toBe('wamid-test');
  });

  it('NUNCA sobrescreve o phone_number_id de uma conversa que já existia com outro número', async () => {
    await seedTemplate('tpl-1');
    await seedNumber('num-1');
    await seedCampaign('camp-1', 'tpl-1');
    await seedCampaignNumber('camp-1', 'num-1');
    await seedPendingRecipients('camp-1', 'num-1', 1, '595911111111');

    // Conversa JÁ existe, associada a um número diferente (ex: número
    // operacional do agente de IA) — simula um contato já conhecido que
    // foi incluído mesmo assim via "incluir mesmo assim".
    await getDb().from('conversations').insert({ tenant_id: TENANT_A, phone: '5959111111110', phone_number_id: 'numero-operacional-existente' });

    await runBroadcastSenderTick();

    const { data: conv } = await getDb().from('conversations').select('*').eq('tenant_id', TENANT_A).eq('phone', '5959111111110').maybeSingle();
    expect(conv?.phone_number_id).toBe('numero-operacional-existente');
    // O envio real ainda tem que ter acontecido, usando as credenciais do
    // número já associado à conversa (não o de disparo).
    expect(sendWhatsAppTemplateMessage).toHaveBeenCalledTimes(1);
  });
});

describe('broadcastSenderJob — agendamento e janela de horário (TASK-0173)', () => {
  it('promove sozinho uma campanha "scheduled" cuja hora já chegou, e ela já envia no mesmo tick', async () => {
    await seedTemplate('tpl-1');
    await seedNumber('num-1');
    await seedCampaign('camp-1', 'tpl-1', { status: 'scheduled', scheduled_at: '2026-08-30T11:59:00Z', consent_confirmed: true });
    await seedCampaignNumber('camp-1', 'num-1');
    await seedPendingRecipients('camp-1', 'num-1', 1);

    await runBroadcastSenderTick();

    // A campanha tinha só 1 destinatário pendente, então além de promover
    // (scheduled -> running) o próprio tick já esvazia a fila e marca
    // completed — o que importa aqui é que ela deixou de ficar presa em
    // "scheduled" esperando pra sempre, e o envio de fato aconteceu.
    const { data: campaign } = await getDb().from('broadcast_campaigns').select('*').eq('id', 'camp-1').maybeSingle();
    expect(campaign.status).not.toBe('scheduled');
    expect(sendWhatsAppTemplateMessage).toHaveBeenCalledTimes(1);
  });

  it('NÃO promove uma campanha "scheduled" cuja hora ainda não chegou', async () => {
    await seedTemplate('tpl-1');
    await seedNumber('num-1');
    await seedCampaign('camp-1', 'tpl-1', { status: 'scheduled', scheduled_at: '2026-08-30T12:01:00Z', consent_confirmed: true });
    await seedCampaignNumber('camp-1', 'num-1');
    await seedPendingRecipients('camp-1', 'num-1', 1);

    await runBroadcastSenderTick();

    const { data: campaign } = await getDb().from('broadcast_campaigns').select('*').eq('id', 'camp-1').maybeSingle();
    expect(campaign.status).toBe('scheduled');
    expect(sendWhatsAppTemplateMessage).not.toHaveBeenCalled();
  });

  it('faz upload do header de imagem ao promover uma campanha agendada, igual a uma ativação manual', async () => {
    await seedTemplate('tpl-1', { header_type: 'image', header_image_base64: 'data:image/jpeg;base64,QQ==' });
    await seedNumber('num-1');
    await seedCampaign('camp-1', 'tpl-1', { status: 'scheduled', scheduled_at: '2026-08-30T11:00:00Z', consent_confirmed: true, header_media_id: null });
    await seedCampaignNumber('camp-1', 'num-1');
    await seedPendingRecipients('camp-1', 'num-1', 1);

    await runBroadcastSenderTick();

    const { data: campaign } = await getDb().from('broadcast_campaigns').select('*').eq('id', 'camp-1').maybeSingle();
    expect(campaign.status).not.toBe('scheduled');
    expect(campaign.header_media_id).toBe('media-id-test');
    expect(uploadWhatsAppMedia).toHaveBeenCalledTimes(1);
  });

  it('respeita a janela de horário da campanha — fora da janela, não envia nada mesmo com destinatários pendentes', async () => {
    await seedTemplate('tpl-1');
    await seedNumber('num-1');
    // NOW = 12:00 UTC; janela 13:00-18:00 UTC ainda não começou.
    await seedCampaign('camp-1', 'tpl-1', { send_window_start: '13:00', send_window_end: '18:00', send_window_timezone: 'UTC' });
    await seedCampaignNumber('camp-1', 'num-1');
    await seedPendingRecipients('camp-1', 'num-1', 1);

    await runBroadcastSenderTick();

    expect(sendWhatsAppTemplateMessage).not.toHaveBeenCalled();
    const { data: pending } = await getDb().from('broadcast_campaign_recipients').select('id').eq('campaign_id', 'camp-1').eq('status', 'pending');
    expect(pending).toHaveLength(1);
  });

  it('dentro da janela de horário, envia normalmente', async () => {
    await seedTemplate('tpl-1');
    await seedNumber('num-1');
    // NOW = 12:00 UTC; janela 09:00-18:00 UTC já está aberta.
    await seedCampaign('camp-1', 'tpl-1', { send_window_start: '09:00', send_window_end: '18:00', send_window_timezone: 'UTC' });
    await seedCampaignNumber('camp-1', 'num-1');
    await seedPendingRecipients('camp-1', 'num-1', 1);

    await runBroadcastSenderTick();

    expect(sendWhatsAppTemplateMessage).toHaveBeenCalledTimes(1);
  });
});

describe('broadcastSenderJob — variação de template', () => {
  it('cada destinatário é enviado usando o template atribuído a ele (não sempre o mesmo)', async () => {
    await seedTemplate('tpl-a', { name: 'template_a' });
    await seedTemplate('tpl-b', { name: 'template_b' });
    await seedNumber('num-1');
    await seedCampaign('camp-1', 'tpl-a');
    await seedCampaignNumber('camp-1', 'num-1');
    await seedCampaignTemplateLink('camp-1', 'tpl-a');
    await seedCampaignTemplateLink('camp-1', 'tpl-b');
    await seedPendingRecipientWithTemplate('camp-1', 'num-1', '595911111111', 'tpl-a');
    await seedPendingRecipientWithTemplate('camp-1', 'num-1', '595922222222', 'tpl-b');

    await runBroadcastSenderTick();

    expect(sendWhatsAppTemplateMessage).toHaveBeenCalledTimes(2);
    const templateNamesUsed = vi.mocked(sendWhatsAppTemplateMessage).mock.calls.map((call) => call[3]);
    expect(templateNamesUsed.sort()).toEqual(['template_a', 'template_b']);
  });

  it('recipient com template_id nulo (campanha antiga, criada antes da variação existir) usa o template principal da campanha', async () => {
    await seedTemplate('tpl-a', { name: 'template_a' });
    await seedNumber('num-1');
    await seedCampaign('camp-1', 'tpl-a');
    await seedCampaignNumber('camp-1', 'num-1');
    // Sem broadcast_campaign_templates nenhum — simula campanha pré-existente.
    await seedPendingRecipients('camp-1', 'num-1', 1);

    await runBroadcastSenderTick();

    expect(sendWhatsAppTemplateMessage).toHaveBeenCalledTimes(1);
    expect(vi.mocked(sendWhatsAppTemplateMessage).mock.calls[0][3]).toBe('template_a');
  });
});
