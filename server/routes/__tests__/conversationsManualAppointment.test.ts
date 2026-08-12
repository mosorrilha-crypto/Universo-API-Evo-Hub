/**
 * Issue #182 — operador cadastra manualmente um agendamento fechado fora da
 * IA (WhatsApp pessoal, telefone, presencial). Cobre: cria evento real no
 * Google Calendar + linha em appointments com source='manual'; recusa
 * quando o contato já tem agendamento ativo; recusa quando o horário está
 * ocupado; 400 em campos faltando; 503 sem Google Calendar configurado.
 */
import express from 'express';
import type { Server } from 'http';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const checkFreeBusy = vi.fn(async () => true);
const createCalendarEvent = vi.fn(async () => 'evt-manual-123');
vi.mock('../../services/googleCalendar', () => ({ checkFreeBusy, createCalendarEvent }));

const { createConversationsRouter } = await import('../conversations');
const { initDb } = await import('../../services/db');
const { createFakeSupabase } = await import('../../services/__tests__/fakeSupabase');

const TENANT_ID = 'tenant-a';
const PHONE = '595981111111';
const CALENDAR_DEPS = { googleClientId: 'id', googleClientSecret: 'secret', googleRedirectUri: 'https://x/redirect' };

let server: Server;
let baseUrl: string;
let supabase: ReturnType<typeof createFakeSupabase>;

function fakeAuthenticateToken(req: any, _res: any, next: any) {
  req.user = { id: 'op-1', tenantId: TENANT_ID, role: 'operator' };
  next();
}

function startServer(deps: Record<string, any> = CALENDAR_DEPS) {
  const app = express();
  app.use(express.json());
  app.use(
    createConversationsRouter({
      authenticateToken: fakeAuthenticateToken as any,
      jwtSecret: 'test-secret',
      metaAccessToken: 'tok',
      metaPhoneNumberId: 'pn',
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
  createCalendarEvent.mockResolvedValue('evt-manual-123');
  supabase = createFakeSupabase();
  initDb(supabase);
});

afterEach(async () => {
  if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe('POST /api/conversations/:phone/manual-appointment', () => {
  it('cria o evento real no Calendar e a linha em appointments com source=manual', async () => {
    ({ server, baseUrl } = await startServer());

    const res = await fetch(`${baseUrl}/api/conversations/${PHONE}/manual-appointment`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ serviceName: 'Microlips', startIso: '2026-08-15T10:00:00', endIso: '2026-08-15T11:30:00' }),
    });
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.appointment).toMatchObject({ eventId: 'evt-manual-123', summary: 'Microlips', source: 'manual' });
    expect(createCalendarEvent).toHaveBeenCalledWith(TENANT_ID, expect.anything(), 'Microlips', expect.any(String), '2026-08-15T10:00:00', '2026-08-15T11:30:00', 'America/Asuncion');

    const rows = supabase.__tables.appointments;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ phone: PHONE, source: 'manual', event_id: 'evt-manual-123' });
  });

  it('400 quando falta serviceName/startIso/endIso', async () => {
    ({ server, baseUrl } = await startServer());
    const res = await fetch(`${baseUrl}/api/conversations/${PHONE}/manual-appointment`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ serviceName: 'Microlips' }),
    });
    expect(res.status).toBe(400);
    expect(createCalendarEvent).not.toHaveBeenCalled();
  });

  it('409 quando o contato já tem um agendamento ativo', async () => {
    supabase.__tables.appointments = [
      { tenant_id: TENANT_ID, phone: PHONE, event_id: 'evt-existente', summary: 'Cejas', start_iso: '2026-08-14T09:00:00', end_iso: '2026-08-14T10:00:00', created_at: new Date().toISOString(), source: 'ai' },
    ];
    ({ server, baseUrl } = await startServer());

    const res = await fetch(`${baseUrl}/api/conversations/${PHONE}/manual-appointment`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ serviceName: 'Microlips', startIso: '2026-08-15T10:00:00', endIso: '2026-08-15T11:30:00' }),
    });
    expect(res.status).toBe(409);
    expect(createCalendarEvent).not.toHaveBeenCalled();
  });

  it('409 quando o horário está ocupado na agenda', async () => {
    checkFreeBusy.mockResolvedValue(false);
    ({ server, baseUrl } = await startServer());

    const res = await fetch(`${baseUrl}/api/conversations/${PHONE}/manual-appointment`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ serviceName: 'Microlips', startIso: '2026-08-15T10:00:00', endIso: '2026-08-15T11:30:00' }),
    });
    expect(res.status).toBe(409);
    expect(createCalendarEvent).not.toHaveBeenCalled();
  });

  it('503 quando o Google Calendar não está configurado neste servidor', async () => {
    ({ server, baseUrl } = await startServer({}));

    const res = await fetch(`${baseUrl}/api/conversations/${PHONE}/manual-appointment`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ serviceName: 'Microlips', startIso: '2026-08-15T10:00:00', endIso: '2026-08-15T11:30:00' }),
    });
    expect(res.status).toBe(503);
  });
});
