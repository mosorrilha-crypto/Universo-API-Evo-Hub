/**
 * Refinamento do benchmark de mercado: lembretes de agendamento passam a
 * usar botões de "Confirmar"/"Remarcar" (interactive/button da Meta Cloud
 * API) em vez de só texto — a maior causa de no-show documentada é
 * dificuldade de remarcar fora do horário comercial, e um botão resolve
 * isso num toque.
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

const sendWhatsAppInteractiveButtons = vi.fn(async () => undefined);
vi.mock('../metaSend', () => ({ sendWhatsAppInteractiveButtons }));

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

describe('reminderJob — lembrete com botões de Confirmar/Remarcar', () => {
  it('manda o lembrete como botões interativos, não texto puro', async () => {
    await checkAndSendReminders({ getCalendarConfig: () => CALENDAR_CONFIG });

    expect(sendWhatsAppInteractiveButtons).toHaveBeenCalledTimes(1);
    const [phoneNumberId, accessToken, to, body, buttons] = sendWhatsAppInteractiveButtons.mock.calls[0] as any[];
    expect(phoneNumberId).toBe('pn');
    expect(accessToken).toBe('tok');
    expect(to).toBe('595981111111');
    // 14:00 UTC vira 11:00 no fuso America/Asuncion — a conversão de fuso já é comportamento existente, não faz parte deste refinamento.
    expect(body).toContain('11:00');
    expect(buttons).toEqual([
      { id: 'lembrete_confirmar', title: '✅ Confirmar' },
      { id: 'lembrete_remarcar', title: '🔄 Remarcar' },
    ]);
    expect(markReminderSent).toHaveBeenCalledWith('tenant-a', 'evt-1', 'mesmo_dia');
  });

  it('não reenvia se já foi mandado pra esse evento/tipo (idempotência)', async () => {
    wasReminderSent.mockResolvedValueOnce(true);
    await checkAndSendReminders({ getCalendarConfig: () => CALENDAR_CONFIG });
    expect(sendWhatsAppInteractiveButtons).not.toHaveBeenCalled();
  });
});
