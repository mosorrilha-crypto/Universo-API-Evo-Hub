/**
 * Acompanhamento de funil (pedido real, 15/08/2026 — auditoria de conversas
 * reais mostrou ZERO agendamentos fechados no dia apesar de dezenas de
 * conversas ativas). Cobre: pendência vencida gera 1 escalonamento; rodar o
 * job duas vezes não duplica; pendência ainda não vencida não gera nada;
 * cancelar (clearPendingFollowUp) remove antes do job rodar.
 *
 * ★ 10/09/2026 — reengajamento automático (pedido real do dono do
 * produto): 'customer_reply' agora tenta UMA mensagem automática da IA
 * antes de escalar, só dentro da janela de 24h da Meta e só entre 7h-19h
 * (America/Asuncion). Sem `ai`/credenciais nos deps (todos os testes
 * antigos acima, que chamam checkPendingFollowUps() sem argumento), o
 * comportamento continua idêntico a antes: escala direto.
 *
 * ★ 12/09/2026 (TASK-0400) — a janela de 24h só se aplica de verdade pro
 * canal Meta (ver describe "canal Evolution" no fim deste arquivo); antes
 * dessa correção, o canal Evolution (usado pelos tenants reais hoje) tinha
 * o mesmo bloqueio incorretamente.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { initDb } from '../db';
import { createFakeSupabase } from './fakeSupabase';
import { markPendingFollowUp, clearPendingFollowUp, listPendingFollowUps } from '../pendingFollowUpStore';
import { listEscalations } from '../escalationStore';

vi.mock('../conversationStore', () => ({
  getConversation: vi.fn().mockResolvedValue({ messages: [{ sender: 'lead', text: 'oi', timestamp: new Date().toISOString() }] }),
  recordOutgoingMessage: vi.fn().mockResolvedValue(undefined),
  // escalationStore.ts (usado por logEscalation, chamado em todo o arquivo) importa isto de conversationStore.
  inferCountryFromPhone: vi.fn().mockReturnValue('Paraguai'),
}));
vi.mock('../agentStatus', () => ({
  isAgentPaused: vi.fn().mockResolvedValue(false),
}));
const DEFAULT_FUNNEL_AUTO_FOLLOW_UP = { enabled: true, delayHours: 2.5, businessHoursStart: 7, businessHoursEnd: 19 };
const getTenantCustomerNotificationPreferences = vi.fn().mockResolvedValue({ funnelAutoFollowUp: DEFAULT_FUNNEL_AUTO_FOLLOW_UP });
vi.mock('../tenantProfileStore', () => ({
  getTenantReminderLanguage: vi.fn().mockResolvedValue('es'),
  getTenantCustomerNotificationPreferences: (...args: any[]) => getTenantCustomerNotificationPreferences(...args),
  funnelAutoFollowUpDelayMs: (prefs: { delayHours: number }) => prefs.delayHours * 60 * 60 * 1000,
}));
vi.mock('../replySafetyGate', () => ({
  reviewAutoReplyBeforeSend: vi.fn().mockResolvedValue({ approved: true, source: 'gemini-reviewer', severity: 'low', reason: 'ok' }),
}));
vi.mock('../tenantResolver', () => ({
  resolveCredentialsForTenant: vi.fn().mockResolvedValue({ provider: 'meta', metaAccessToken: 'token', metaPhoneNumberId: 'phone-id' }),
}));
vi.mock('../metaSend', () => ({
  sendWhatsAppTextMessage: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../evolutionSend', () => ({
  sendEvolutionTextMessage: vi.fn().mockResolvedValue(undefined),
}));

import { getConversation, recordOutgoingMessage } from '../conversationStore';
import { isAgentPaused } from '../agentStatus';
import { sendWhatsAppTextMessage } from '../metaSend';
import { sendEvolutionTextMessage } from '../evolutionSend';
import { resolveCredentialsForTenant } from '../tenantResolver';
import { checkPendingFollowUps } from '../pendingFollowUpJob';

const TENANT_A = '11111111-1111-1111-1111-111111111111';

function fakeAi(text = '¡Hola! ¿Seguís con interés en tu turno? Puedo ayudarte a elegir el mejor horario 😊') {
  return { models: { generateContent: vi.fn().mockResolvedValue({ text }) } } as any;
}

beforeEach(() => {
  initDb(createFakeSupabase());
  vi.useFakeTimers();
  // 2026-08-15T18:00:00Z = 15:00 em America/Asuncion (UTC-3) — dentro da janela 7h-19h.
  vi.setSystemTime(new Date('2026-08-15T18:00:00Z'));
  vi.clearAllMocks();
  (isAgentPaused as any).mockResolvedValue(false);
  (getConversation as any).mockResolvedValue({ messages: [{ sender: 'lead', text: 'oi', timestamp: new Date().toISOString() }] });
  (resolveCredentialsForTenant as any).mockResolvedValue({ provider: 'meta', metaAccessToken: 'token', metaPhoneNumberId: 'phone-id' });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('pendingFollowUpStore', () => {
  it('markPendingFollowUp não duplica quando já existe uma pendência aberta do mesmo (tenant, phone, kind)', async () => {
    await markPendingFollowUp(TENANT_A, '595981111111', 'Cliente A', 'customer_reply', 'ofereceu sábado ou segunda', '2026-08-15T20:30:00Z');
    await markPendingFollowUp(TENANT_A, '595981111111', 'Cliente A', 'customer_reply', 'ofereceu outro horário', '2026-08-15T21:00:00Z');

    const pending = await listPendingFollowUps(TENANT_A);
    expect(pending).toHaveLength(1);
    expect(pending[0].reason).toBe('ofereceu outro horário');
  });

  it('clearPendingFollowUp remove a pendência ainda não alertada', async () => {
    await markPendingFollowUp(TENANT_A, '595981111111', 'Cliente A', 'customer_reply', 'ofereceu sábado', '2026-08-15T20:30:00Z');
    await clearPendingFollowUp(TENANT_A, '595981111111', 'customer_reply');

    expect(await listPendingFollowUps(TENANT_A)).toHaveLength(0);
  });

  it('kinds diferentes pro mesmo telefone não colidem', async () => {
    await markPendingFollowUp(TENANT_A, '595981111111', 'Cliente A', 'customer_reply', 'esperando escolha', '2026-08-15T20:30:00Z');
    await markPendingFollowUp(TENANT_A, '595981111111', 'Cliente A', 'owner_review', 'foto de trabalho anterior', '2026-08-15T20:00:00Z');

    expect(await listPendingFollowUps(TENANT_A)).toHaveLength(2);
  });
});

describe('pendingFollowUpJob', () => {
  it('pendência vencida (due_at no passado) gera 1 escalonamento pro operador', async () => {
    await markPendingFollowUp(TENANT_A, '595981111111', 'Cliente A', 'customer_reply', 'ofereceu sábado ou segunda', '2026-08-15T17:00:00Z');

    await checkPendingFollowUps();

    const escalations = await listEscalations(TENANT_A);
    expect(escalations).toHaveLength(1);
    expect(escalations[0].phone).toBe('595981111111');
    expect(escalations[0].kind).toBe('customer_reply');
    expect(escalations[0].reason).toContain('ofereceu sábado ou segunda');
  });

  it('pendência ainda não vencida (due_at no futuro) não gera nada ainda', async () => {
    await markPendingFollowUp(TENANT_A, '595981111111', 'Cliente A', 'owner_review', 'foto de trabalho anterior', '2026-08-15T23:00:00Z');

    await checkPendingFollowUps();

    expect(await listEscalations(TENANT_A)).toHaveLength(0);
  });

  it('rodar o job duas vezes seguidas NÃO duplica o escalonamento (idempotência)', async () => {
    await markPendingFollowUp(TENANT_A, '595981111111', 'Cliente A', 'customer_reply', 'ofereceu horário', '2026-08-15T17:00:00Z');

    await checkPendingFollowUps();
    await checkPendingFollowUps();

    expect(await listEscalations(TENANT_A)).toHaveLength(1);
  });

  it('pendência cancelada antes do job rodar não gera nenhum escalonamento', async () => {
    await markPendingFollowUp(TENANT_A, '595981111111', 'Cliente A', 'customer_reply', 'ofereceu horário', '2026-08-15T17:00:00Z');
    await clearPendingFollowUp(TENANT_A, '595981111111', 'customer_reply');

    await checkPendingFollowUps();

    expect(await listEscalations(TENANT_A)).toHaveLength(0);
  });

  it('reason do escalonamento distingue owner_review de customer_reply', async () => {
    await markPendingFollowUp(TENANT_A, '595981111111', 'Cliente A', 'owner_review', 'trabalho anterior de cejas', '2026-08-15T17:00:00Z');

    await checkPendingFollowUps();

    const escalations = await listEscalations(TENANT_A);
    expect(escalations[0].reason).toContain('avaliação');
    expect(escalations[0].reason).toContain('trabalho anterior de cejas');
  });
});

describe('pendingFollowUpJob — reengajamento automático (customer_reply)', () => {
  it('dentro da janela de 24h e das 7h-19h: manda UMA mensagem automática, marca autoFollowUpSentAt e NÃO escala ainda', async () => {
    const ai = fakeAi();
    await markPendingFollowUp(TENANT_A, '595981111111', 'Cliente A', 'customer_reply', 'ofereceu sábado ou segunda', '2026-08-15T17:00:00Z');

    await checkPendingFollowUps({ getAi: () => ai, metaAccessToken: 'token', metaPhoneNumberId: 'phone-id' });

    expect(await listEscalations(TENANT_A)).toHaveLength(0);
    expect(sendWhatsAppTextMessage).toHaveBeenCalledTimes(1);
    expect(recordOutgoingMessage).toHaveBeenCalledWith(
      TENANT_A,
      '595981111111',
      expect.objectContaining({ type: 'text' }),
      'ai'
    );

    const [pending] = await (await import('../pendingFollowUpStore')).listPendingFollowUps(TENANT_A);
    expect(pending.autoFollowUpSentAt).toBeTruthy();
    // due_at foi empurrado pra frente (mesma janela de novo antes de escalar).
    expect(new Date(pending.dueAt).getTime()).toBeGreaterThan(new Date('2026-08-15T18:00:00Z').getTime());
  });

  it('cliente continua em silêncio até o novo vencimento: escala pro operador em vez de tentar reengajar de novo', async () => {
    const ai = fakeAi();
    await markPendingFollowUp(TENANT_A, '595981111111', 'Cliente A', 'customer_reply', 'ofereceu sábado ou segunda', '2026-08-15T17:00:00Z');
    await checkPendingFollowUps({ getAi: () => ai, metaAccessToken: 'token', metaPhoneNumberId: 'phone-id' });
    expect(await listEscalations(TENANT_A)).toHaveLength(0);

    // Avança o relógio pra depois do novo due_at (~2h30 à frente).
    vi.setSystemTime(new Date('2026-08-15T21:00:00Z'));
    await checkPendingFollowUps({ getAi: () => ai, metaAccessToken: 'token', metaPhoneNumberId: 'phone-id' });

    expect(sendWhatsAppTextMessage).toHaveBeenCalledTimes(1); // não tentou de novo
    const escalations = await listEscalations(TENANT_A);
    expect(escalations).toHaveLength(1);
    expect(escalations[0].reason).toContain('já tentou reengajar automaticamente');
  });

  it('fora da janela de 7h-19h: não manda mensagem nem escala ainda — fica pendente pro próximo tick dentro do horário', async () => {
    const ai = fakeAi();
    // 2026-08-15T04:00:00Z = 01:00 em America/Asuncion — fora de 7h-19h.
    vi.setSystemTime(new Date('2026-08-15T04:00:00Z'));
    await markPendingFollowUp(TENANT_A, '595981111111', 'Cliente A', 'customer_reply', 'ofereceu sábado ou segunda', '2026-08-15T03:00:00Z');

    await checkPendingFollowUps({ getAi: () => ai, metaAccessToken: 'token', metaPhoneNumberId: 'phone-id' });

    expect(sendWhatsAppTextMessage).not.toHaveBeenCalled();
    expect(await listEscalations(TENANT_A)).toHaveLength(0);
    const pending = await listPendingFollowUps(TENANT_A);
    expect(pending).toHaveLength(1);
    expect(pending[0].autoFollowUpSentAt).toBeFalsy();
  });

  it('janela de 24h da Meta já fechada: escala direto, mesmo com IA disponível (nunca manda texto livre fora da janela)', async () => {
    const ai = fakeAi();
    (getConversation as any).mockResolvedValue({ messages: [{ sender: 'lead', text: 'oi', timestamp: '2026-08-10T12:00:00Z' }] });
    await markPendingFollowUp(TENANT_A, '595981111111', 'Cliente A', 'customer_reply', 'ofereceu sábado ou segunda', '2026-08-15T17:00:00Z');

    await checkPendingFollowUps({ getAi: () => ai, metaAccessToken: 'token', metaPhoneNumberId: 'phone-id' });

    expect(sendWhatsAppTextMessage).not.toHaveBeenCalled();
    const escalations = await listEscalations(TENANT_A);
    expect(escalations).toHaveLength(1);
  });

  it('agente pausado pro tenant: não manda reengajamento automático, escala como de costume', async () => {
    const ai = fakeAi();
    (isAgentPaused as any).mockResolvedValue(true);
    await markPendingFollowUp(TENANT_A, '595981111111', 'Cliente A', 'customer_reply', 'ofereceu sábado ou segunda', '2026-08-15T17:00:00Z');

    await checkPendingFollowUps({ getAi: () => ai, metaAccessToken: 'token', metaPhoneNumberId: 'phone-id' });

    expect(sendWhatsAppTextMessage).not.toHaveBeenCalled();
    expect(await listEscalations(TENANT_A)).toHaveLength(1);
  });

  it('owner_review nunca tenta reengajamento automático — sempre escala direto', async () => {
    const ai = fakeAi();
    await markPendingFollowUp(TENANT_A, '595981111111', 'Cliente A', 'owner_review', 'foto de trabalho anterior', '2026-08-15T17:00:00Z');

    await checkPendingFollowUps({ getAi: () => ai, metaAccessToken: 'token', metaPhoneNumberId: 'phone-id' });

    expect(sendWhatsAppTextMessage).not.toHaveBeenCalled();
    expect(await listEscalations(TENANT_A)).toHaveLength(1);
  });
});

/**
 * TASK-0399 (12/09/2026): `funnelAutoFollowUp` (migration 0089) — liga/desliga
 * geral, janela de horário e atraso, hoje configuráveis por tenant. O
 * default reproduz exatamente os antigos `AUTO_FOLLOWUP_START_HOUR/_END_HOUR`
 * (7-19) e `CUSTOMER_REPLY_FOLLOWUP_MS` (2.5h) — já cobertos pelos testes
 * acima, que usam o mock default (`DEFAULT_FUNNEL_AUTO_FOLLOW_UP`).
 */
describe('pendingFollowUpJob — preferência funnelAutoFollowUp (TASK-0399)', () => {
  it('enabled = false: nem tenta gerar mensagem — escala direto sem chamar a IA', async () => {
    getTenantCustomerNotificationPreferences.mockResolvedValueOnce({ funnelAutoFollowUp: { ...DEFAULT_FUNNEL_AUTO_FOLLOW_UP, enabled: false } });
    const ai = fakeAi();
    await markPendingFollowUp(TENANT_A, '595981111111', 'Cliente A', 'customer_reply', 'ofereceu sábado ou segunda', '2026-08-15T17:00:00Z');

    await checkPendingFollowUps({ getAi: () => ai, metaAccessToken: 'token', metaPhoneNumberId: 'phone-id' });

    expect(ai.models.generateContent).not.toHaveBeenCalled();
    expect(sendWhatsAppTextMessage).not.toHaveBeenCalled();
    expect(await listEscalations(TENANT_A)).toHaveLength(1);
  });

  it('businessHoursStart/End customizados: um horário que o default 7-19h permitiria fica fora da janela customizada', async () => {
    // 2026-08-15T18:00:00Z = 15:00 em America/Asuncion (dentro do default 7-19h, fora de uma janela customizada 8-14h).
    getTenantCustomerNotificationPreferences.mockResolvedValueOnce({ funnelAutoFollowUp: { ...DEFAULT_FUNNEL_AUTO_FOLLOW_UP, businessHoursStart: 8, businessHoursEnd: 14 } });
    const ai = fakeAi();
    await markPendingFollowUp(TENANT_A, '595981111111', 'Cliente A', 'customer_reply', 'ofereceu sábado ou segunda', '2026-08-15T17:00:00Z');

    await checkPendingFollowUps({ getAi: () => ai, metaAccessToken: 'token', metaPhoneNumberId: 'phone-id' });

    expect(sendWhatsAppTextMessage).not.toHaveBeenCalled();
    expect(await listEscalations(TENANT_A)).toHaveLength(0); // 'wait', não escala ainda
  });

  it('delayHours customizado empurra o novo due_at pela quantidade certa, não pelo default de 2.5h', async () => {
    getTenantCustomerNotificationPreferences.mockResolvedValueOnce({ funnelAutoFollowUp: { ...DEFAULT_FUNNEL_AUTO_FOLLOW_UP, delayHours: 5 } });
    const ai = fakeAi();
    await markPendingFollowUp(TENANT_A, '595981111111', 'Cliente A', 'customer_reply', 'ofereceu sábado ou segunda', '2026-08-15T17:00:00Z');

    await checkPendingFollowUps({ getAi: () => ai, metaAccessToken: 'token', metaPhoneNumberId: 'phone-id' });

    const [pending] = await listPendingFollowUps(TENANT_A);
    const pushedMs = new Date(pending.dueAt).getTime() - new Date('2026-08-15T18:00:00Z').getTime();
    expect(pushedMs).toBe(5 * 60 * 60 * 1000);
  });
});

/**
 * TASK-0400 (12/09/2026, achado real: os tenants reais hoje, Daniel e
 * Monique, usam Evolution, não Meta): antes desta correção, a checagem de
 * "janela de 24h" rodava ANTES de saber o canal do tenant — um tenant
 * Evolution com o cliente calado há mais de 24h escalava sem necessidade,
 * mesmo podendo responder texto livre a qualquer momento nesse canal (a
 * janela de 24h é uma regra específica da Meta Cloud API).
 */
describe('pendingFollowUpJob — canal Evolution não tem janela de 24h (TASK-0400)', () => {
  it('cliente calado há mais de 24h no canal Evolution: ainda assim tenta o reengajamento automático, não escala direto', async () => {
    (resolveCredentialsForTenant as any).mockResolvedValueOnce({
      provider: 'evolution', evolutionInstanceName: 'inst-daniel', evolutionApiUrl: 'https://evo.example.com', evolutionApiKey: 'evo-key',
    });
    (getConversation as any).mockResolvedValue({ messages: [{ sender: 'lead', text: 'oi', timestamp: '2026-08-10T12:00:00Z' }] }); // > 24h antes do tick abaixo
    const ai = fakeAi();
    await markPendingFollowUp(TENANT_A, '595981111111', 'Cliente A', 'customer_reply', 'ofereceu sábado ou segunda', '2026-08-15T17:00:00Z');

    await checkPendingFollowUps({ getAi: () => ai, evolutionApiUrl: 'shared', evolutionApiKey: 'shared', evolutionInstanceName: 'shared' });

    expect(sendEvolutionTextMessage).toHaveBeenCalledTimes(1);
    expect(sendEvolutionTextMessage).toHaveBeenCalledWith('inst-daniel', 'https://evo.example.com', 'evo-key', '595981111111', expect.any(String));
    expect(sendWhatsAppTextMessage).not.toHaveBeenCalled();
    expect(await listEscalations(TENANT_A)).toHaveLength(0); // não escalou — tentou reengajar
  });
});
