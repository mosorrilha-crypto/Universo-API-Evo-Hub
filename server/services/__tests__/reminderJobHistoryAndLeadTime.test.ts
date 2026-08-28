/**
 * Achados reais em produção (27/08/2026), tenant Monique — cliente Jessica Garcia:
 * (1) o lembrete "dia_anterior" disparava minutos depois de um agendamento ter
 * sido criado no mesmo dia (para o dia seguinte), duplicando reforço com o
 * lembrete "mesmo_dia" da manhã seguinte — decisão do dono do produto: só manda
 * a véspera pra quem agendou com 72h+ de antecedência.
 * (2) a mensagem de lembrete nunca era gravada na conversa — sumia do painel e
 * do contexto que o agente recompõe se for reativado depois.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

const listConnectedCalendarTenants = vi.fn(async () => ['tenant-a']);
let mockEvents: { id: string; startIso: string }[] = [];
const listUpcomingEvents = vi.fn(async () => mockEvents);
vi.mock('../googleCalendar', () => ({
  listConnectedCalendarTenants: (...args: unknown[]) => listConnectedCalendarTenants(...(args as [])),
  listUpcomingEvents: (...args: unknown[]) => listUpcomingEvents(...(args as [])),
  localNaiveToUtcIso: (naive: string) => `${naive}Z`,
}));

let mockAppointments: { phone: string; eventId: string; summary: string; startIso: string; endIso: string; createdAt: string }[] = [];
vi.mock('../appointmentStore', () => ({
  listAllAppointments: async () => mockAppointments,
}));

const wasReminderSent = vi.fn(async () => false);
const markReminderSent = vi.fn(async () => undefined);
vi.mock('../reminderStore', () => ({ wasReminderSent, markReminderSent }));

const sendWhatsAppTemplateMessage = vi.fn(async () => ({ messageId: 'wamid.test' }));
vi.mock('../metaSend', () => ({ sendWhatsAppTemplateMessage }));
vi.mock('../evolutionSend', () => ({ sendEvolutionTextMessage: vi.fn() }));
vi.mock('../tenantResolver', () => ({
  resolveCredentialsForTenant: async () => ({ provider: 'meta', metaAccessToken: 'tok', metaPhoneNumberId: 'pn' }),
}));

const { checkAndSendReminders } = await import('../reminderJob');
const { createFakeSupabase } = await import('./fakeSupabase');
const { initDb } = await import('../db');

const CALENDAR_CONFIG = { clientId: 'id', clientSecret: 'secret', redirectUri: 'https://x/redirect' };

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
  mockEvents = [];
  mockAppointments = [];
});

describe('reminderJob — lembrete "dia_anterior" exige 72h+ de antecedência', () => {
  it('NÃO manda o lembrete da véspera quando o agendamento foi criado no mesmo dia (pra amanhã)', async () => {
    initDb(createFakeSupabase({ tenants: [{ id: 'tenant-a', reminder_language: 'es' }] }));
    mockEvents = [{ id: 'evt-1', startIso: '2026-08-11T14:00:00.000Z' }]; // amanhã (segunda 10/08 é "hoje")
    mockAppointments = [{
      phone: '595981111111', eventId: 'evt-1', summary: 'Diseño con Henna',
      startIso: '2026-08-11T14:00:00', endIso: '2026-08-11T14:30:00',
      createdAt: '2026-08-10T15:00:00.000Z', // criado hoje, ~23h antes do compromisso
    }];
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-10T19:00:00Z')); // hoje, depois das 08:30

    await checkAndSendReminders({ getCalendarConfig: () => CALENDAR_CONFIG });

    expect(sendWhatsAppTemplateMessage).not.toHaveBeenCalled();
    expect(markReminderSent).not.toHaveBeenCalled();
  });

  it('manda o lembrete da véspera quando o agendamento foi feito com 72h+ de antecedência', async () => {
    initDb(createFakeSupabase({ tenants: [{ id: 'tenant-a', reminder_language: 'es' }] }));
    mockEvents = [{ id: 'evt-1', startIso: '2026-08-11T14:00:00.000Z' }];
    mockAppointments = [{
      phone: '595981111111', eventId: 'evt-1', summary: 'Diseño con Henna',
      startIso: '2026-08-11T14:00:00', endIso: '2026-08-11T14:30:00',
      createdAt: '2026-08-05T10:00:00.000Z', // criado 6 dias antes
    }];
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-10T19:00:00Z'));

    await checkAndSendReminders({ getCalendarConfig: () => CALENDAR_CONFIG });

    expect(sendWhatsAppTemplateMessage).toHaveBeenCalledTimes(1);
    expect(markReminderSent).toHaveBeenCalledWith('tenant-a', 'evt-1', 'dia_anterior');
  });

  it('lembrete "mesmo_dia" não exige antecedência — manda mesmo pra agendamento recém-criado', async () => {
    initDb(createFakeSupabase({ tenants: [{ id: 'tenant-a', reminder_language: 'es' }] }));
    mockEvents = [{ id: 'evt-1', startIso: '2026-08-10T14:00:00.000Z' }]; // hoje
    mockAppointments = [{
      phone: '595981111111', eventId: 'evt-1', summary: 'Diseño con Henna',
      startIso: '2026-08-10T14:00:00', endIso: '2026-08-10T14:30:00',
      createdAt: '2026-08-10T13:00:00.000Z', // criado 1h antes do próprio compromisso
    }];
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-10T13:30:00Z')); // 10:30 em Asuncion, depois das 07:30

    await checkAndSendReminders({ getCalendarConfig: () => CALENDAR_CONFIG });

    expect(sendWhatsAppTemplateMessage).toHaveBeenCalledTimes(1);
    expect(markReminderSent).toHaveBeenCalledWith('tenant-a', 'evt-1', 'mesmo_dia');
  });
});

describe('reminderJob — horários fixos por tipo (08:30 véspera / 07:30 mesmo dia)', () => {
  it('não manda a véspera antes das 08:30, mesmo já elegível por antecedência', async () => {
    initDb(createFakeSupabase({ tenants: [{ id: 'tenant-a', reminder_language: 'es' }] }));
    mockEvents = [{ id: 'evt-1', startIso: '2026-08-11T14:00:00.000Z' }];
    mockAppointments = [{
      phone: '595981111111', eventId: 'evt-1', summary: 'Diseño con Henna',
      startIso: '2026-08-11T14:00:00', endIso: '2026-08-11T14:30:00',
      createdAt: '2026-08-05T10:00:00.000Z',
    }];
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-10T11:00:00Z')); // 08:00 em Asuncion — antes das 08:30

    await checkAndSendReminders({ getCalendarConfig: () => CALENDAR_CONFIG });

    expect(sendWhatsAppTemplateMessage).not.toHaveBeenCalled();
  });

  it('não manda o mesmo_dia antes das 07:30', async () => {
    initDb(createFakeSupabase({ tenants: [{ id: 'tenant-a', reminder_language: 'es' }] }));
    mockEvents = [{ id: 'evt-1', startIso: '2026-08-10T14:00:00.000Z' }];
    mockAppointments = [{
      phone: '595981111111', eventId: 'evt-1', summary: 'Diseño con Henna',
      startIso: '2026-08-10T14:00:00', endIso: '2026-08-10T14:30:00',
      createdAt: '2026-08-05T10:00:00.000Z',
    }];
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-10T10:00:00Z')); // 07:00 em Asuncion — antes das 07:30

    await checkAndSendReminders({ getCalendarConfig: () => CALENDAR_CONFIG });

    expect(sendWhatsAppTemplateMessage).not.toHaveBeenCalled();
  });
});

describe('reminderJob — lembrete enviado com sucesso entra no histórico da conversa', () => {
  it('grava o texto do lembrete em `messages`, com sentBy "ai", pro painel e pro contexto do agente', async () => {
    const supabase = createFakeSupabase({ tenants: [{ id: 'tenant-a', reminder_language: 'es' }] });
    initDb(supabase as any);
    mockEvents = [{ id: 'evt-1', startIso: '2026-08-10T14:00:00.000Z' }];
    mockAppointments = [{
      phone: '595981111111', eventId: 'evt-1', summary: 'Diseño con Henna',
      startIso: '2026-08-10T14:00:00', endIso: '2026-08-10T14:30:00',
      createdAt: '2026-08-05T10:00:00.000Z',
    }];
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-10T12:00:00Z')); // 09:00 em Asuncion

    await checkAndSendReminders({ getCalendarConfig: () => CALENDAR_CONFIG });

    expect(sendWhatsAppTemplateMessage).toHaveBeenCalledTimes(1);
    const savedMessages = (supabase.__tables.messages || []) as any[];
    expect(savedMessages).toHaveLength(1);
    expect(savedMessages[0]).toMatchObject({
      tenant_id: 'tenant-a',
      sender: 'agent',
      sent_by: 'ai',
      type: 'text',
    });
    expect(savedMessages[0].text).toContain('hoy');
  });
});
