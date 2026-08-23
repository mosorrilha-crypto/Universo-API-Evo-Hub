/**
 * Achado numa auditoria (16/08/2026, cruzando o documento "prompts finais"
 * com o código real): setPaymentVerification só gravava o status no banco —
 * nunca liberava o evento real no Google Calendar. Um comprovante rejeitado
 * deixava o horário ocupado indefinidamente (só a data passar liberava esse
 * telefone pra um novo criar_agendamento), bloqueando outras clientes reais
 * de reservar aquele mesmo horário enquanto isso. Agora, rejeitar cancela o
 * evento real e libera a linha — best-effort: se o Calendar falhar, a linha
 * fica intacta (com o eventId) pra um humano cancelar manualmente depois.
 */
import express from 'express';
import type { Server } from 'http';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

const cancelCalendarEvent = vi.fn(async (..._args: any[]) => undefined);
vi.mock('../../services/googleCalendar', async () => {
  const actual = await vi.importActual<typeof import('../../services/googleCalendar')>('../../services/googleCalendar');
  return { ...actual, cancelCalendarEvent, checkFreeBusy: vi.fn(), createCalendarEvent: vi.fn() };
});

const { createConversationsRouter } = await import('../conversations');
const { initDb } = await import('../../services/db');
const { createFakeSupabase } = await import('../../services/__tests__/fakeSupabase');

const TENANT_ID = 'tenant-a';
const PHONE = '595981111111';
const OPERATOR_ID = 'op-123';

let server: Server;
let baseUrl: string;
let supabase: ReturnType<typeof createFakeSupabase>;

function fakeAuthenticateToken(req: any, _res: any, next: any) {
  req.user = { id: OPERATOR_ID, tenantId: TENANT_ID, role: 'admin' };
  next();
}

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use(
    createConversationsRouter({
      authenticateToken: fakeAuthenticateToken as any,
      jwtSecret: 'test-secret',
      metaAccessToken: 'tok',
      metaPhoneNumberId: 'pn',
      // Calendar configurado — ao contrário de conversationsVerifyPayment.test.ts,
      // este arquivo testa exatamente o caminho onde a liberação do slot roda.
      googleClientId: 'client-id',
      googleClientSecret: 'client-secret',
      googleRedirectUri: 'https://example.test/oauth-callback',
    })
  );
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => resolve());
  });
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  baseUrl = `http://127.0.0.1:${port}`;
});

afterAll(() => {
  server.close();
});

afterEach(() => {
  cancelCalendarEvent.mockClear();
  cancelCalendarEvent.mockImplementation(async () => undefined);
});

function seed() {
  supabase = createFakeSupabase({
    appointments: [
      {
        tenant_id: TENANT_ID,
        phone: PHONE,
        event_id: 'evt-1',
        summary: 'Microlips',
        start_iso: new Date(Date.now() + 3600_000).toISOString(),
        end_iso: new Date(Date.now() + 7200_000).toISOString(),
        created_at: new Date().toISOString(),
        payment_status: 'pending_verification',
        payment_proof_message_id: 'wamid-1',
        payment_verified_by: null,
        payment_verified_at: null,
      },
    ],
  });
  initDb(supabase);
}

describe('POST /api/conversations/:phone/verify-payment — libera o horário no Calendar quando rejeita', () => {
  it('status "rejected" cancela o evento real e limpa a linha de appointments', async () => {
    seed();
    const res = await fetch(`${baseUrl}/api/conversations/${PHONE}/verify-payment`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'rejected' }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();

    expect(data.calendarReleased).toBe(true);
    expect(cancelCalendarEvent).toHaveBeenCalledWith(TENANT_ID, expect.anything(), 'evt-1');
    expect(supabase.__tables.appointments.find((a: any) => a.phone === PHONE)).toBeUndefined();
  });

  it('status "verified" NUNCA cancela o evento — turno segue válido', async () => {
    seed();
    const res = await fetch(`${baseUrl}/api/conversations/${PHONE}/verify-payment`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'verified' }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();

    expect(data.calendarReleased).toBe(false);
    expect(cancelCalendarEvent).not.toHaveBeenCalled();
    expect(supabase.__tables.appointments.find((a: any) => a.phone === PHONE)).toBeDefined();
  });

  it('se o cancelamento no Calendar falhar, mantém a linha intacta (eventId preservado pra humano cancelar manualmente)', async () => {
    seed();
    cancelCalendarEvent.mockImplementation(async () => {
      throw new Error('Google Calendar indisponível (simulado)');
    });

    const res = await fetch(`${baseUrl}/api/conversations/${PHONE}/verify-payment`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'rejected' }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();

    expect(data.calendarReleased).toBe(false);
    expect(data.appointment.paymentStatus).toBe('rejected');
    const row = supabase.__tables.appointments.find((a: any) => a.phone === PHONE);
    expect(row).toBeDefined();
    expect(row.event_id).toBe('evt-1');
  });
});
