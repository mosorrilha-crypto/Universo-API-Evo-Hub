/**
 * Achado real em produção (20/08/2026): o lembrete automático de agendamento
 * (reminderJob.ts) tinha dois bugs reais numa tenant paraguaia real —
 * (1) texto sempre em português, mesmo pra leads que só falam espanhol com
 * a IA o tempo todo, e (2) um lembrete "mesmo_dia" disparado às 00:30,
 * porque o job só checava se a DATA batia com hoje, nunca a HORA.
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
  listAllAppointments: vi.fn(async () => [{ phone: '595981111111', eventId: 'evt-1', summary: 'Diseño con Henna', startIso: '2026-08-10T14:00:00', endIso: '2026-08-10T14:30:00' }]),
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

const CALENDAR_CONFIG = { clientId: 'id', clientSecret: 'secret', redirectUri: 'https://x/redirect' };
// Segunda-feira 07:30–20:00 (mesmo expediente real usado noutros testes).
const MONDAY_HOURS = { '1': { open: '07:30', close: '20:00' } };

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe('reminderJob — idioma do lembrete por tenant', () => {
  it('tenant com reminder_language "es" recebe o texto em espanhol, não em português', async () => {
    initDb(createFakeSupabase({ tenants: [{ id: 'tenant-a', reminder_language: 'es', business_hours: MONDAY_HOURS }] }));
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-10T12:00:00Z')); // segunda, 11:00 em America/Asuncion — dentro do expediente

    await checkAndSendReminders({ getCalendarConfig: () => CALENDAR_CONFIG });

    expect(sendWhatsAppTemplateMessage).toHaveBeenCalledTimes(1);
    const [, , , templateName, templateLanguage, bodyParams] = sendWhatsAppTemplateMessage.mock.calls[0] as any[];
    expect(templateName).toBe('lembrete_agendamento_es');
    expect(templateLanguage).toBe('es');
    expect(bodyParams[0]).toBe('hoy');
  });

  it('tenant com reminder_language "pt" continua recebendo o texto em português', async () => {
    initDb(createFakeSupabase({ tenants: [{ id: 'tenant-a', reminder_language: 'pt', business_hours: MONDAY_HOURS }] }));
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-10T12:00:00Z'));

    await checkAndSendReminders({ getCalendarConfig: () => CALENDAR_CONFIG });

    expect(sendWhatsAppTemplateMessage).toHaveBeenCalledTimes(1);
    const [, , , templateName, templateLanguage, bodyParams] = sendWhatsAppTemplateMessage.mock.calls[0] as any[];
    expect(templateName).toBe('lembrete_agendamento_pt');
    expect(templateLanguage).toBe('pt_BR');
    expect(bodyParams[0]).toBe('hoje');
  });

  it('tenant sem linha em `tenants` (falha ao buscar idioma) cai no default "es", nunca quebra o job', async () => {
    initDb(createFakeSupabase({})); // nenhuma linha — getTenantReminderLanguage cai no default
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-10T12:00:00Z'));

    await checkAndSendReminders({ getCalendarConfig: () => CALENDAR_CONFIG });

    expect(sendWhatsAppTemplateMessage).toHaveBeenCalledTimes(1);
    const [, , , templateName] = sendWhatsAppTemplateMessage.mock.calls[0] as any[];
    expect(templateName).toBe('lembrete_agendamento_es');
  });
});

describe('reminderJob — lembrete "mesmo_dia" só depois do horário de abertura', () => {
  it('NÃO manda o lembrete de madrugada (00:30), mesmo com o evento já sendo hoje', async () => {
    initDb(createFakeSupabase({ tenants: [{ id: 'tenant-a', reminder_language: 'es', business_hours: MONDAY_HOURS }] }));
    vi.useFakeTimers();
    // 2026-08-10T03:30:00Z = 2026-08-10 00:30 em America/Asuncion (UTC-3) — mesmo dia do evento mockado, mas de madrugada.
    vi.setSystemTime(new Date('2026-08-10T03:30:00Z'));

    await checkAndSendReminders({ getCalendarConfig: () => CALENDAR_CONFIG });

    expect(sendWhatsAppTemplateMessage).not.toHaveBeenCalled();
    expect(markReminderSent).not.toHaveBeenCalled();
  });

  it('manda normalmente depois que o expediente abre', async () => {
    initDb(createFakeSupabase({ tenants: [{ id: 'tenant-a', reminder_language: 'es', business_hours: MONDAY_HOURS }] }));
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-10T12:00:00Z')); // 09:00 em America/Asuncion — depois das 07:30 de abertura

    await checkAndSendReminders({ getCalendarConfig: () => CALENDAR_CONFIG });

    expect(sendWhatsAppTemplateMessage).toHaveBeenCalledTimes(1);
  });

  it('sem expediente configurado, cai no horário de corte padrão (07:00) em vez de travar o lembrete', async () => {
    initDb(createFakeSupabase({ tenants: [{ id: 'tenant-a', reminder_language: 'es', business_hours: null }] }));
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-10T12:00:00Z')); // 09:00 em America/Asuncion — depois do fallback 07:00

    await checkAndSendReminders({ getCalendarConfig: () => CALENDAR_CONFIG });

    expect(sendWhatsAppTemplateMessage).toHaveBeenCalledTimes(1);
  });
});
