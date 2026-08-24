/**
 * Achado real CONFIRMADO em produção (20/08/2026, ver reminderJob.ts): o
 * lembrete usava botões interativos de texto livre
 * (`sendWhatsAppInteractiveButtons`) — só funciona DENTRO da janela de 24h
 * desde a última mensagem do cliente. Lembrete é proativo por definição, então
 * precisa de um TEMPLATE aprovado pela Meta com botões quick-reply
 * (`sendWhatsAppTemplateMessage` com `buttonPayloads`).
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

const listConnectedCalendarTenants = vi.fn(async () => ['tenant-a']);
const listUpcomingEvents = vi.fn(async () => [{ id: 'evt-1', startIso: '2026-08-10T14:00:00.000Z' }]);
vi.mock('../googleCalendar', () => ({
  listConnectedCalendarTenants,
  listUpcomingEvents,
  localNaiveToUtcIso: (naive: string) => `${naive}Z`,
}));

const listAllAppointments = vi.fn(async () => [{ phone: '595981111111', eventId: 'evt-1', summary: 'Diseño con Henna', startIso: '2026-08-10T14:00:00', endIso: '2026-08-10T14:30:00' }]);
vi.mock('../appointmentStore', () => ({ listAllAppointments }));

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

const CALENDAR_CONFIG = { clientId: 'id', clientSecret: 'secret', redirectUri: 'https://x/redirect' };

beforeEach(() => {
  vi.useFakeTimers();
  // "hoje" fixo = 2026-08-10, o mesmo dia do evento mockado -> tipo "mesmo_dia".
  vi.setSystemTime(new Date('2026-08-10T12:00:00Z'));
});

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe('reminderJob — lembrete via template aprovado com botões quick-reply', () => {
  it('manda o lembrete como template com botões, não texto/interativo livre', async () => {
    await checkAndSendReminders({ getCalendarConfig: () => CALENDAR_CONFIG });

    expect(sendWhatsAppTemplateMessage).toHaveBeenCalledTimes(1);
    const [phoneNumberId, accessToken, to, templateName, templateLanguage, bodyParams, buttonPayloads] = sendWhatsAppTemplateMessage.mock.calls[0] as any[];
    expect(phoneNumberId).toBe('pn');
    expect(accessToken).toBe('tok');
    expect(to).toBe('595981111111');
    // Tenant sem `reminder_language` configurado cai no default 'es'
    // (migration 0038) — é o idioma real da única tenant em produção.
    expect(templateName).toBe('lembrete_agendamento_es');
    expect(templateLanguage).toBe('es');
    // 14:00 UTC vira 11:00 no fuso America/Asuncion — a conversão de fuso já é comportamento existente, não faz parte deste refinamento.
    expect(bodyParams).toEqual(['hoy', '11:00']);
    expect(buttonPayloads).toEqual(['lembrete_confirmar', 'lembrete_remarcar']);
    expect(markReminderSent).toHaveBeenCalledWith('tenant-a', 'evt-1', 'mesmo_dia');
  });

  it('não reenvia se já foi mandado pra esse evento/tipo (idempotência)', async () => {
    wasReminderSent.mockResolvedValueOnce(true);
    await checkAndSendReminders({ getCalendarConfig: () => CALENDAR_CONFIG });
    expect(sendWhatsAppTemplateMessage).not.toHaveBeenCalled();
  });
});
