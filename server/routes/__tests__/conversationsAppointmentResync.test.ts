/**
 * TASK-0292 — pedido direto do dono do produto, com print da Ficha do
 * Contato ("este campo não está conectado a agenda, e eu não consigo editar
 * pois a cliente remarcou"): `appointments` guarda só um snapshot do evento
 * vinculado ao telefone, que fica desatualizado se o reagendamento acontecer
 * fora dos fluxos que já escrevem nessa tabela (IA, manual-appointment,
 * link-appointment) — ex.: editar o evento direto no Google Calendar. Cobre:
 * 400 sem agendamento vinculado; 503 sem Google Calendar configurado; 404
 * quando o eventId rastreado não aparece na janela de busca (linha
 * preservada); 200 sem mudança quando o evento já bate; 200 com `changed`
 * quando o horário real mudou, preservando payment_status.
 */
import express from 'express';
import type { Server } from 'http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const listUpcomingEvents = vi.fn(async () => [] as Array<{ id: string; summary: string; startIso: string; endIso?: string }>);
vi.mock('../../services/googleCalendar', () => ({ listUpcomingEvents }));

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

async function resync() {
  return fetch(`${baseUrl}/api/conversations/${PHONE}/appointment/resync`, { method: 'POST' });
}

beforeEach(() => {
  vi.clearAllMocks();
  listUpcomingEvents.mockResolvedValue([]);
  supabase = createFakeSupabase();
  initDb(supabase);
});

afterEach(async () => {
  if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe('POST /api/conversations/:phone/appointment/resync', () => {
  it('400 quando o contato não tem nenhum agendamento vinculado', async () => {
    ({ server, baseUrl } = await startServer());
    const res = await resync();
    expect(res.status).toBe(400);
    expect(listUpcomingEvents).not.toHaveBeenCalled();
  });

  it('503 quando o Google Calendar não está configurado neste servidor', async () => {
    supabase.__tables.appointments = [
      { tenant_id: TENANT_ID, phone: PHONE, event_id: 'evt-1', summary: 'Cejas', start_iso: '2026-08-15T10:00:00', end_iso: '2026-08-15T11:00:00', created_at: new Date().toISOString(), source: 'ai' },
    ];
    ({ server, baseUrl } = await startServer({}));
    const res = await resync();
    expect(res.status).toBe(503);
  });

  it('404 quando o evento rastreado não aparece na agenda — não apaga a linha existente', async () => {
    supabase.__tables.appointments = [
      { tenant_id: TENANT_ID, phone: PHONE, event_id: 'evt-sumiu', summary: 'Cejas', start_iso: '2026-08-15T10:00:00', end_iso: '2026-08-15T11:00:00', created_at: new Date().toISOString(), source: 'ai' },
    ];
    listUpcomingEvents.mockResolvedValue([]);
    ({ server, baseUrl } = await startServer());

    const res = await resync();
    expect(res.status).toBe(404);
    expect(supabase.__tables.appointments[0]).toMatchObject({ event_id: 'evt-sumiu', start_iso: '2026-08-15T10:00:00' });
  });

  it('200 sem alteração quando o evento real já bate com o rastreado (changed: false)', async () => {
    supabase.__tables.appointments = [
      { tenant_id: TENANT_ID, phone: PHONE, event_id: 'evt-1', summary: 'Cejas', start_iso: '2026-08-15T10:00:00', end_iso: '2026-08-15T11:00:00', created_at: new Date().toISOString(), source: 'ai' },
    ];
    listUpcomingEvents.mockResolvedValue([{ id: 'evt-1', summary: 'Cejas', startIso: '2026-08-15T10:00:00', endIso: '2026-08-15T11:00:00' }]);
    ({ server, baseUrl } = await startServer());

    const res = await resync();
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.changed).toBe(false);
  });

  it('200 com changed:true quando o horário real mudou (reagendado fora do app) — preserva payment_status', async () => {
    supabase.__tables.appointments = [
      {
        tenant_id: TENANT_ID, phone: PHONE, event_id: 'evt-1', summary: 'Cejas', start_iso: '2026-08-15T10:00:00', end_iso: '2026-08-15T11:00:00',
        created_at: new Date().toISOString(), source: 'ai', payment_status: 'confirmed',
      },
    ];
    listUpcomingEvents.mockResolvedValue([{ id: 'evt-1', summary: 'Cejas', startIso: '2026-08-16T14:00:00', endIso: '2026-08-16T15:00:00' }]);
    ({ server, baseUrl } = await startServer());

    const res = await resync();
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.changed).toBe(true);
    expect(data.appointment).toMatchObject({ startIso: '2026-08-16T14:00:00', endIso: '2026-08-16T15:00:00', paymentStatus: 'confirmed' });

    const rows = supabase.__tables.appointments;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ event_id: 'evt-1', start_iso: '2026-08-16T14:00:00', end_iso: '2026-08-16T15:00:00', payment_status: 'confirmed' });
  });
});
