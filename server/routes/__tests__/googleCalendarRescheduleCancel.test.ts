/**
 * TASK-0404 — achado real durante a reformulação da Ficha do Cliente: remarcar
 * ou cancelar um agendamento pelo widget de Agenda nunca registrava o evento
 * ('rescheduled'/'cancelled') na jornada do contato (`appointment_journey_events`)
 * — só o caminho da IA (autoReply.ts) fazia isso. A nova seção "Jornada do
 * contato" na Ficha ficaria incompleta pra qualquer ação feita por aqui.
 * Este teste cobre o fix: as duas rotas agora registram o evento também.
 */
import express from 'express';
import type { Server } from 'http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { initDb } from '../../services/db';
import { createFakeSupabase } from '../../services/__tests__/fakeSupabase';
import { listContactJourney } from '../../services/contactJourneyStore';

const checkFreeBusy = vi.fn(async (_tenantId: string, _cfg: unknown, _startIso: string, _endIso: string) => true);
const rescheduleCalendarEvent = vi.fn(async () => undefined);
const cancelCalendarEvent = vi.fn(async () => undefined);

vi.mock('../../services/googleCalendar', () => ({
  isGoogleCalendarConnected: vi.fn(async () => true),
  listUpcomingEvents: vi.fn(async () => []),
  getGoogleAuthUrl: vi.fn(),
  handleGoogleOAuthCallback: vi.fn(),
  disconnectGoogleCalendar: vi.fn(),
  signOAuthState: vi.fn(),
  verifyOAuthState: vi.fn(),
  updateCalendarEventSummary: vi.fn(),
  findAvailabilityForDate: vi.fn(),
  checkFreeBusy,
  rescheduleCalendarEvent,
  cancelCalendarEvent,
}));

const { createGoogleCalendarRouter } = await import('../googleCalendar');

const TENANT_A = 'tenant-a';
const PHONE = '5511900000001';
const EVENT_ID = 'evt-remarcar-1';
const ROUTER_DEPS = {
  googleClientId: 'client-id',
  googleClientSecret: 'client-secret',
  googleRedirectUri: 'https://x/oauth-callback',
  jwtSecret: 'test-secret',
};

let server: Server;
let baseUrl: string;

function fakeAuthenticateToken(tenantId: string) {
  return (req: any, _res: any, next: any) => {
    req.user = { id: 'op-1', tenantId, role: 'manager' };
    next();
  };
}

function startServer(tenantId: string) {
  const app = express();
  app.use(express.json());
  app.use(createGoogleCalendarRouter({
    authenticateToken: fakeAuthenticateToken(tenantId) as any,
    isAgendaModuleEnabled: async () => true,
    ...ROUTER_DEPS,
  }));
  return new Promise<{ server: Server; baseUrl: string }>((resolve) => {
    const s = app.listen(0, () => {
      const address = s.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      resolve({ server: s, baseUrl: `http://127.0.0.1:${port}` });
    });
  });
}

function seedAppointment() {
  initDb(createFakeSupabase({
    appointments: [
      {
        tenant_id: TENANT_A,
        phone: PHONE,
        event_id: EVENT_ID,
        summary: 'Combo Micro Cejas + Labios',
        start_iso: new Date(Date.now() + 3600_000).toISOString(),
        end_iso: new Date(Date.now() + 7200_000).toISOString(),
        created_at: new Date().toISOString(),
      },
    ],
  }));
}

beforeEach(() => {
  seedAppointment();
});

afterEach(async () => {
  vi.clearAllMocks();
  if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe('PATCH /api/google-calendar/events/:eventId/reschedule', () => {
  it('registra um evento "rescheduled" na jornada do contato depois de remarcar com sucesso', async () => {
    ({ server, baseUrl } = await startServer(TENANT_A));
    const newStartIso = '2026-10-01T14:00:00';
    const newEndIso = '2026-10-01T15:00:00';

    const res = await fetch(`${baseUrl}/api/google-calendar/events/${EVENT_ID}/reschedule`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ newStartIso, newEndIso }),
    });

    expect(res.status).toBe(200);
    expect(rescheduleCalendarEvent).toHaveBeenCalledWith(TENANT_A, expect.anything(), EVENT_ID, newStartIso, newEndIso);

    const journey = await listContactJourney(TENANT_A, PHONE);
    const rescheduled = journey.find((e) => e.kind === 'appointment' && e.eventType === 'rescheduled');
    expect(rescheduled).toMatchObject({
      kind: 'appointment',
      eventType: 'rescheduled',
      serviceSummary: 'Combo Micro Cejas + Labios',
      scheduledStart: newStartIso,
      scheduledEnd: newEndIso,
      eventId: EVENT_ID,
      actor: 'operator',
    });
  });

  it('não registra jornada nenhuma quando o novo horário já está ocupado (409)', async () => {
    checkFreeBusy.mockResolvedValueOnce(false);
    ({ server, baseUrl } = await startServer(TENANT_A));

    const res = await fetch(`${baseUrl}/api/google-calendar/events/${EVENT_ID}/reschedule`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ newStartIso: '2026-10-01T14:00:00', newEndIso: '2026-10-01T15:00:00' }),
    });

    expect(res.status).toBe(409);
    expect(rescheduleCalendarEvent).not.toHaveBeenCalled();
    const journey = await listContactJourney(TENANT_A, PHONE);
    expect(journey.find((e) => e.kind === 'appointment' && e.eventType === 'rescheduled')).toBeUndefined();
  });
});

describe('DELETE /api/google-calendar/events/:eventId', () => {
  it('registra um evento "cancelled" na jornada do contato depois de cancelar com sucesso', async () => {
    ({ server, baseUrl } = await startServer(TENANT_A));

    const res = await fetch(`${baseUrl}/api/google-calendar/events/${EVENT_ID}`, { method: 'DELETE' });

    expect(res.status).toBe(200);
    expect(cancelCalendarEvent).toHaveBeenCalledWith(TENANT_A, expect.anything(), EVENT_ID);

    const journey = await listContactJourney(TENANT_A, PHONE);
    const cancelled = journey.find((e) => e.kind === 'appointment' && e.eventType === 'cancelled');
    expect(cancelled).toMatchObject({
      kind: 'appointment',
      eventType: 'cancelled',
      serviceSummary: 'Combo Micro Cejas + Labios',
      eventId: EVENT_ID,
      actor: 'operator',
    });
  });
});
