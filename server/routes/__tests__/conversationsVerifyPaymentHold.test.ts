/**
 * Issue #289 (18/08/2026) — criar_agendamento não cria mais o evento real no
 * Google Calendar direto, só uma reserva (payment_status='awaiting_payment',
 * sem event_id). POST /verify-payment com status='verified' é o gatilho real
 * pra criar o evento — cobre: cria o evento quando aprovado, recusa quando o
 * horário ficou ocupado nesse meio-tempo, e uma rejeição de reserva (sem
 * evento ainda) só limpa a linha, sem chamar o Calendar.
 */
import express from 'express';
import type { Server } from 'http';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const checkFreeBusy = vi.fn(async () => true);
const createCalendarEvent = vi.fn(async () => 'evt-aprovado-123');
const cancelCalendarEvent = vi.fn(async () => undefined);
vi.mock('../../services/googleCalendar', () => ({ checkFreeBusy, createCalendarEvent, cancelCalendarEvent }));

const { createConversationsRouter } = await import('../conversations');
const { initDb } = await import('../../services/db');
const { createFakeSupabase } = await import('../../services/__tests__/fakeSupabase');

const TENANT_ID = 'tenant-a';
const OPERATOR_ID = 'op-123';
const PHONE = '595981234567';
const CALENDAR_DEPS = { googleClientId: 'id', googleClientSecret: 'secret', googleRedirectUri: 'https://x/redirect' };

let server: Server;
let baseUrl: string;
let supabase: ReturnType<typeof createFakeSupabase>;

function fakeAuthenticateToken(req: any, _res: any, next: any) {
  req.user = { id: OPERATOR_ID, tenantId: TENANT_ID, role: 'admin' };
  next();
}

function startServer(deps: Record<string, any> = CALENDAR_DEPS) {
  const app = express();
  app.use(express.json());
  app.use(
    createConversationsRouter({
      authenticateToken: fakeAuthenticateToken as any,
      metaAccessToken: 'tok',
      jwtSecret: 'test-secret',
      metaPhoneNumberId: 'pn',
      isAgendaModuleEnabled: async () => true,
      ...deps,
    })
  );
  return new Promise<{ server: Server; baseUrl: string }>((resolve) => {
    const s = app.listen(0, () => {
      const address = s.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      resolve({ server: s, baseUrl: `http://127.0.0.1:${port}` });
    });
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  checkFreeBusy.mockResolvedValue(true);
  createCalendarEvent.mockResolvedValue('evt-aprovado-123');
  supabase = createFakeSupabase({
    appointments: [
      {
        tenant_id: TENANT_ID, phone: PHONE, event_id: null, summary: 'Microlips',
        start_iso: '2026-08-10T10:00:00', end_iso: '2026-08-10T11:30:00', created_at: new Date().toISOString(),
        payment_status: 'awaiting_payment', held_until: new Date(Date.now() + 3600_000).toISOString(),
      },
    ],
  });
  initDb(supabase);
});

afterEach(async () => {
  if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe('POST /api/conversations/:phone/verify-payment — reserva sem evento real ainda (issue #289)', () => {
  it('status=verified cria o evento real na hora e grava o eventId', async () => {
    ({ server, baseUrl } = await startServer());

    const res = await fetch(`${baseUrl}/api/conversations/${PHONE}/verify-payment`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'verified' }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(createCalendarEvent).toHaveBeenCalledWith(TENANT_ID, expect.anything(), 'Microlips', expect.any(String), '2026-08-10T10:00:00', '2026-08-10T11:30:00', 'America/Asuncion');
    expect(data.appointment).toMatchObject({ eventId: 'evt-aprovado-123', paymentStatus: 'verified', paymentVerifiedBy: OPERATOR_ID });

    const rows = supabase.__tables.appointments;
    expect(rows[0]).toMatchObject({ event_id: 'evt-aprovado-123', payment_status: 'verified', held_until: null });
  });

  it('status=verified: 409 quando o horário ficou ocupado enquanto o pagamento era analisado — não cria o evento', async () => {
    checkFreeBusy.mockResolvedValue(false);
    ({ server, baseUrl } = await startServer());

    const res = await fetch(`${baseUrl}/api/conversations/${PHONE}/verify-payment`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'verified' }),
    });
    expect(res.status).toBe(409);
    expect(createCalendarEvent).not.toHaveBeenCalled();

    const rows = supabase.__tables.appointments;
    expect(rows[0]).toMatchObject({ event_id: null, payment_status: 'awaiting_payment' });
  });

  it('status=verified: 503 quando o Google Calendar não está configurado neste servidor', async () => {
    ({ server, baseUrl } = await startServer({}));

    const res = await fetch(`${baseUrl}/api/conversations/${PHONE}/verify-payment`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'verified' }),
    });
    expect(res.status).toBe(503);
    expect(createCalendarEvent).not.toHaveBeenCalled();
  });

  it('status=rejected numa reserva sem evento ainda: limpa a linha direto, sem chamar o Calendar', async () => {
    ({ server, baseUrl } = await startServer());

    const res = await fetch(`${baseUrl}/api/conversations/${PHONE}/verify-payment`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'rejected' }),
    });
    expect(res.status).toBe(200);
    expect(cancelCalendarEvent).not.toHaveBeenCalled();

    const rows = supabase.__tables.appointments;
    expect(rows).toHaveLength(0);
  });
});
