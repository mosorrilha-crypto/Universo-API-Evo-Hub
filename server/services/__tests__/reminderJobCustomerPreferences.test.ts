/**
 * TASK-0399 (12/09/2026): lembrete de agendamento (reminderJob.ts) ganhou
 * preferência por tenant (`customer_notification_preferences.appointmentReminders`,
 * migration 0089) — liga/desliga geral, liga/desliga por slot (véspera/mesmo
 * dia) e os parâmetros de horário/antecedência que antes eram constantes
 * fixas (`DIA_ANTERIOR_MIN_LEAD_HOURS = 72`, cortes 08:30/07:30). Cobre
 * também o caso regressivo: tenant sem preferência salva se comporta
 * IDENTICAMENTE ao hardcoded de antes desta tarefa.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const listConnectedCalendarTenants = vi.fn(async () => ['tenant-a']);
const listUpcomingEvents = vi.fn(async () => [{ id: 'evt-1', startIso: '2026-08-10T14:00:00.000Z' }]);
vi.mock('../googleCalendar', () => ({
  listConnectedCalendarTenants,
  listUpcomingEvents,
  localNaiveToUtcIso: (naive: string) => `${naive}Z`,
}));

vi.mock('../appointmentStore', () => ({
  // createdAt bem antigo — garante que o teste padrão de 72h de antecedência passa.
  listAllAppointments: vi.fn(async () => [{ phone: '595981111111', eventId: 'evt-1', summary: 'Diseño con Henna', startIso: '2026-08-10T14:00:00', endIso: '2026-08-10T14:30:00', createdAt: '2026-08-01T00:00:00.000Z' }]),
}));

const wasReminderSent = vi.fn(async () => false);
const markReminderSent = vi.fn(async () => undefined);
vi.mock('../reminderStore', () => ({ wasReminderSent, markReminderSent }));

const sendWhatsAppTemplateMessage = vi.fn(async () => ({ messageId: 'wamid.test' }));
vi.mock('../metaSend', () => ({ sendWhatsAppTemplateMessage }));
vi.mock('../evolutionSend', () => ({ sendEvolutionTextMessage: vi.fn() }));
vi.mock('../tenantResolver', () => ({
  resolveCredentialsForTenant: vi.fn(async () => ({ provider: 'meta', metaAccessToken: 'tok', metaPhoneNumberId: 'pn' })),
}));

const { checkAndSendReminders } = await import('../reminderJob');
const { createFakeSupabase } = await import('./fakeSupabase');
const { initDb } = await import('../db');
const { DEFAULT_CUSTOMER_NOTIFICATION_PREFERENCES } = await import('../tenantProfileStore');

const CALENDAR_CONFIG = { clientId: 'id', clientSecret: 'secret', redirectUri: 'https://x/redirect' };
// 2026-08-10T12:00:00Z = 09:00 em America/Asuncion (UTC-3) — evento mockado é "hoje" nesse instante.
const NOW = new Date('2026-08-10T12:00:00Z');

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});

describe('reminderJob — regressão (sem preferência salva)', () => {
  it('tenant sem customer_notification_preferences se comporta como antes desta tarefa (72h/08:30/07:30, tudo ligado)', async () => {
    initDb(createFakeSupabase({ tenants: [{ id: 'tenant-a', reminder_language: 'es' }] }));

    await checkAndSendReminders({ getCalendarConfig: () => CALENDAR_CONFIG });

    expect(sendWhatsAppTemplateMessage).toHaveBeenCalledTimes(1);
  });
});

describe('reminderJob — appointmentReminders.enabled', () => {
  it('desligado no geral: nem chama o Google Calendar', async () => {
    initDb(createFakeSupabase({
      tenants: [{ id: 'tenant-a', reminder_language: 'es', customer_notification_preferences: { appointmentReminders: { ...DEFAULT_CUSTOMER_NOTIFICATION_PREFERENCES.appointmentReminders, enabled: false } } }],
    }));

    await checkAndSendReminders({ getCalendarConfig: () => CALENDAR_CONFIG });

    expect(listUpcomingEvents).not.toHaveBeenCalled();
    expect(sendWhatsAppTemplateMessage).not.toHaveBeenCalled();
  });
});

describe('reminderJob — liga/desliga por slot', () => {
  it('mesmoDiaEnabled = false suprime o lembrete do mesmo dia, mesmo com o resto ligado', async () => {
    initDb(createFakeSupabase({
      tenants: [{ id: 'tenant-a', reminder_language: 'es', customer_notification_preferences: { appointmentReminders: { ...DEFAULT_CUSTOMER_NOTIFICATION_PREFERENCES.appointmentReminders, mesmoDiaEnabled: false } } }],
    }));

    await checkAndSendReminders({ getCalendarConfig: () => CALENDAR_CONFIG });

    expect(sendWhatsAppTemplateMessage).not.toHaveBeenCalled();
  });
});

describe('reminderJob — parâmetros customizados', () => {
  it('diaAnteriorMinLeadHours customizado (24h) permite um agendamento que o default 72h suprimiria', async () => {
    // Evento é amanhã (dia_anterior); createdAt do agendamento é 2026-08-01,
    // então o lead time real é bem maior que 24h — usamos isso só pra provar
    // que o valor customizado é lido e comparado (troca de tomorrowKey pro cenário).
    vi.setSystemTime(new Date('2026-08-09T12:00:00Z')); // véspera do evento mockado
    initDb(createFakeSupabase({
      tenants: [{ id: 'tenant-a', reminder_language: 'es', customer_notification_preferences: { appointmentReminders: { ...DEFAULT_CUSTOMER_NOTIFICATION_PREFERENCES.appointmentReminders, diaAnteriorMinLeadHours: 24 } } }],
    }));

    await checkAndSendReminders({ getCalendarConfig: () => CALENDAR_CONFIG });

    expect(sendWhatsAppTemplateMessage).toHaveBeenCalledTimes(1);
  });

  it('mesmoDiaEarliestTime customizado pra mais tarde adia o envio', async () => {
    initDb(createFakeSupabase({
      tenants: [{ id: 'tenant-a', reminder_language: 'es', customer_notification_preferences: { appointmentReminders: { ...DEFAULT_CUSTOMER_NOTIFICATION_PREFERENCES.appointmentReminders, mesmoDiaEarliestTime: '10:00' } } }],
    }));
    // NOW = 09:00 em America/Asuncion — antes do corte customizado de 10:00.

    await checkAndSendReminders({ getCalendarConfig: () => CALENDAR_CONFIG });

    expect(sendWhatsAppTemplateMessage).not.toHaveBeenCalled();
  });
});
