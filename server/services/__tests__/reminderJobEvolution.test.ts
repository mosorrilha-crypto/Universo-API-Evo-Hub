/**
 * Epic 4.6 follow-up: o job de lembretes (véspera/dia do agendamento) só
 * falava com a Meta Cloud API, mesmo pra tenants conectados via Evolution
 * API — mesma lacuna corrigida em conversations.ts (envio manual do painel).
 * Cobre que um tenant com credencial Evolution cadastrada usa
 * evolutionSend.ts, nunca metaSend.ts, e vice-versa.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const listConnectedCalendarTenants = vi.fn(async () => ['tenant-evolution', 'tenant-meta']);
const listUpcomingEvents = vi.fn(async () => [
  { id: 'evt-1', summary: 'Corte', startIso: new Date().toISOString() },
]);
const listAllAppointments = vi.fn(async (tenantId: string) => [
  { eventId: 'evt-1', phone: tenantId === 'tenant-evolution' ? '595981111111' : '595982222222' },
]);
const wasReminderSent = vi.fn(async () => false);
const markReminderSent = vi.fn(async () => undefined);
const sendWhatsAppInteractiveButtons = vi.fn(async () => undefined);
const sendEvolutionTextMessage = vi.fn(async () => undefined);

vi.mock('../googleCalendar', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../googleCalendar')>();
  return { ...actual, listConnectedCalendarTenants, listUpcomingEvents };
});
vi.mock('../appointmentStore', () => ({ listAllAppointments }));
vi.mock('../reminderStore', () => ({ wasReminderSent, markReminderSent }));
vi.mock('../metaSend', () => ({ sendWhatsAppInteractiveButtons }));
vi.mock('../evolutionSend', () => ({ sendEvolutionTextMessage }));

const { checkAndSendReminders } = await import('../reminderJob');
const { createFakeSupabase } = await import('./fakeSupabase');
const { initDb } = await import('../db');

beforeEach(() => {
  listConnectedCalendarTenants.mockClear();
  listUpcomingEvents.mockClear();
  listAllAppointments.mockClear();
  wasReminderSent.mockClear();
  markReminderSent.mockClear();
  sendWhatsAppInteractiveButtons.mockClear();
  sendEvolutionTextMessage.mockClear();

  initDb(createFakeSupabase({
    tenant_evolution_credentials: [
      { tenant_id: 'tenant-evolution', instance_name: 'instancia-cliente', api_url: 'https://evo-cliente.example.com', api_key: 'tenant-evo-key' },
    ],
  }));
});

describe('reminderJob — roteamento por provedor (Evolution vs Meta)', () => {
  it('usa evolutionSend pro tenant com credencial Evolution, e metaSend pro tenant sem credencial (fallback Meta)', async () => {
    await checkAndSendReminders({
      getCalendarConfig: () => ({ clientId: 'cid', clientSecret: 'secret', redirectUri: 'https://x' }),
      metaAccessToken: 'shared-tok',
      metaPhoneNumberId: 'shared-pn',
      evolutionApiUrl: 'https://evo.example.com',
      evolutionApiKey: 'shared-evo-key',
      evolutionInstanceName: 'shared-instance',
    });

    expect(sendEvolutionTextMessage).toHaveBeenCalledTimes(1);
    expect(sendEvolutionTextMessage).toHaveBeenCalledWith(
      'instancia-cliente', 'https://evo-cliente.example.com', 'tenant-evo-key',
      '595981111111', expect.any(String)
    );

    expect(sendWhatsAppInteractiveButtons).toHaveBeenCalledTimes(1);
    expect(sendWhatsAppInteractiveButtons).toHaveBeenCalledWith('shared-pn', 'shared-tok', '595982222222', expect.any(String), expect.any(Array));
  });
});
