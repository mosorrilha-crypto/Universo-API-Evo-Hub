/**
 * TASK-0421 — achado real (tenant Monique, contato "Johana Orue", print do
 * painel): o operador clicou em "Confirmar pagamento" no card de
 * Escalonamentos (o ÚNICO botão do painel que aprova comprovante de
 * pagamento), o agendamento ficou marcado como "confirmado" e o funil
 * avançou pra "Agendamento Confirmado" — mas nada disso criou o evento
 * real no Google Calendar da tenant (risco real de overbooking), e o
 * Financeiro nunca registrou a transação (depende do `eventId` como
 * referência estável de dedupe).
 *
 * Causa raiz: uma pré-reserva feita pela IA (`criar_pre_reserva`) fica sem
 * `event_id` até o operador aprovar o comprovante (issue #289) — só que
 * essa lógica de criar o evento real na hora da aprovação vivia SÓ em
 * POST /api/conversations/:phone/verify-payment, um endpoint que nenhum
 * botão do painel chama desde a unificação da verificação de pagamento
 * dentro do card de Escalonamentos (12/08/2026). O endpoint que o botão
 * REALMENTE chama, POST /api/escalations/:id/resolve-payment, nunca ganhou
 * essa mesma lógica — só marcava `payment_status = 'verified'` sem nunca
 * criar o evento.
 *
 * Correção: extraída a lógica de criação do evento (checkFreeBusy +
 * createCalendarEvent + attachCalendarEventToHold) pra uma função
 * compartilhada (`ensureCalendarEventForApprovedPayment`), usada pelos
 * dois endpoints — nunca mais pode divergir entre eles.
 */
import express from 'express';
import type { Server } from 'http';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

const checkFreeBusy = vi.fn(async (_tenantId: string, _cfg: unknown, _startIso: string, _endIso: string) => true);
const createCalendarEvent = vi.fn(async () => 'evt-criado-na-aprovacao');

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
  createCalendarEvent,
  rescheduleCalendarEvent: vi.fn(),
  cancelCalendarEvent: vi.fn(),
}));

const { createConversationsRouter } = await import('../conversations');
const { initDb } = await import('../../services/db');
const { createFakeSupabase } = await import('../../services/__tests__/fakeSupabase');

const TENANT_ID = 'tenant-a';
const PHONE = '595983199490';
const OPERATOR_ID = 'op-1';

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
      metaPhoneNumberId: 'pn-1',
      googleClientId: 'client-id',
      googleClientSecret: 'client-secret',
      googleRedirectUri: 'https://universo.example.com/oauth/callback',
      isAgendaModuleEnabled: async () => true,
      isFinancialModuleEnabled: async () => true,
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
  checkFreeBusy.mockClear();
  createCalendarEvent.mockClear();
});

function seed() {
  supabase = createFakeSupabase({
    tenants: [{ id: TENANT_ID, name: 'Monique Sorrilha Beauty Studio' }],
    conversations: [
      { id: 'conv-1', tenant_id: TENANT_ID, phone: PHONE, name: 'Johana Orue', updated_at: new Date().toISOString(), last_read_at: '1970-01-01T00:00:00.000Z', messages: [] },
    ],
    escalations: [
      {
        id: 'esc-1',
        tenant_id: TENANT_ID,
        phone: PHONE,
        contact_name: 'Johana Orue',
        reason: 'Possível comprovante de pagamento recebido',
        last_message: '[imagem]',
        country: 'Paraguay',
        resolved: false,
        kind: 'payment_proof',
        created_at: new Date().toISOString(),
        operator_reply: null,
        operator_reply_at: null,
        operator_reply_consumed_at: null,
      },
    ],
    appointments: [
      {
        tenant_id: TENANT_ID,
        phone: PHONE,
        // Pré-reserva feita pela IA — sem evento real ainda (achado real).
        event_id: null,
        summary: 'Combo Full Face - 1ª Sesión (Johana Orue)',
        start_iso: '2026-09-23T09:30:00',
        end_iso: '2026-09-23T10:30:00',
        created_at: new Date().toISOString(),
        payment_status: 'pending_verification',
        payment_proof_message_id: 'wamid-1',
        payment_verified_by: null,
        payment_verified_at: null,
        payment_pending_since: new Date().toISOString(),
        payment_pending_alerted_at: null,
      },
    ],
  });
  initDb(supabase);
}

describe('POST /api/escalations/:id/resolve-payment — pré-reserva sem evento real (TASK-0421)', () => {
  it('cria o evento real no Calendar ao aprovar o pagamento pelo card de Escalonamentos, e registra a transação financeira', async () => {
    seed();

    const res = await fetch(`${baseUrl}/api/escalations/esc-1/resolve-payment`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone: PHONE, status: 'verified' }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();

    expect(checkFreeBusy).toHaveBeenCalledTimes(1);
    expect(createCalendarEvent).toHaveBeenCalledTimes(1);
    expect(createCalendarEvent).toHaveBeenCalledWith(TENANT_ID, expect.anything(), 'Combo Full Face - 1ª Sesión (Johana Orue)', expect.any(String), '2026-09-23T09:30:00', '2026-09-23T10:30:00', expect.any(String));

    // O agendamento retornado (e a linha real no banco) precisam ter o
    // eventId real, nunca mais null — é o que faltava pra bloquear o
    // horário de verdade e pro Financeiro conseguir deduplicar.
    expect(data.appointment.eventId).toBe('evt-criado-na-aprovacao');
    expect(data.appointment.paymentStatus).toBe('verified');
    const apptRow = supabase.__tables.appointments.find((a: any) => a.phone === PHONE);
    expect(apptRow.event_id).toBe('evt-criado-na-aprovacao');

    const financeRow = supabase.__tables.financial_transactions?.find((t: any) => t.lead_phone === PHONE);
    expect(financeRow).toBeTruthy();
    expect(financeRow.status).toBe('pago');
  });

  it('não marca o pagamento como verificado quando o horário ficou ocupado nesse meio-tempo (409)', async () => {
    seed();
    checkFreeBusy.mockResolvedValueOnce(false);

    const res = await fetch(`${baseUrl}/api/escalations/esc-1/resolve-payment`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone: PHONE, status: 'verified' }),
    });
    expect(res.status).toBe(409);
    expect(createCalendarEvent).not.toHaveBeenCalled();

    const apptRow = supabase.__tables.appointments.find((a: any) => a.phone === PHONE);
    expect(apptRow.payment_status).toBe('pending_verification');
    expect(apptRow.event_id).toBeNull();
  });

  it('503 quando o Google Calendar não está configurado no servidor — não marca o pagamento', async () => {
    seed();
    const appNoCalendar = express();
    appNoCalendar.use(express.json());
    appNoCalendar.use(
      createConversationsRouter({
        authenticateToken: fakeAuthenticateToken as any,
        jwtSecret: 'test-secret',
        metaAccessToken: 'tok',
        metaPhoneNumberId: 'pn-1',
        isAgendaModuleEnabled: async () => true,
        isFinancialModuleEnabled: async () => true,
        // Sem googleClientId/googleClientSecret/googleRedirectUri — calendarConfig fica undefined.
      })
    );
    const s = appNoCalendar.listen(0);
    await new Promise<void>((resolve) => s.once('listening', resolve));
    const address = s.address();
    const url = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`;

    const res = await fetch(`${url}/api/escalations/esc-1/resolve-payment`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone: PHONE, status: 'verified' }),
    });
    expect(res.status).toBe(503);
    const apptRow = supabase.__tables.appointments.find((a: any) => a.phone === PHONE);
    expect(apptRow.payment_status).toBe('pending_verification');
    s.close();
  });

  it('não tenta criar evento quando o agendamento já tem um real (comportamento de sempre, sem regressão)', async () => {
    supabase = createFakeSupabase({
      tenants: [{ id: TENANT_ID, name: 'Monique Sorrilha Beauty Studio' }],
      conversations: [
        { id: 'conv-1', tenant_id: TENANT_ID, phone: PHONE, name: 'Johana Orue', updated_at: new Date().toISOString(), last_read_at: '1970-01-01T00:00:00.000Z', messages: [] },
      ],
      escalations: [
        {
          id: 'esc-1',
          tenant_id: TENANT_ID,
          phone: PHONE,
          contact_name: 'Johana Orue',
          reason: 'Possível comprovante de pagamento recebido',
          last_message: '[imagem]',
          country: 'Paraguay',
          resolved: false,
          kind: 'payment_proof',
          created_at: new Date().toISOString(),
          operator_reply: null,
          operator_reply_at: null,
          operator_reply_consumed_at: null,
        },
      ],
      appointments: [
        {
          tenant_id: TENANT_ID,
          phone: PHONE,
          event_id: 'evt-ja-existente',
          summary: 'Corte + escova',
          start_iso: '2026-09-23T09:30:00',
          end_iso: '2026-09-23T10:30:00',
          created_at: new Date().toISOString(),
          payment_status: 'pending_verification',
          payment_proof_message_id: 'wamid-1',
          payment_verified_by: null,
          payment_verified_at: null,
        },
      ],
    });
    initDb(supabase);

    const res = await fetch(`${baseUrl}/api/escalations/esc-1/resolve-payment`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone: PHONE, status: 'verified' }),
    });
    expect(res.status).toBe(200);
    expect(checkFreeBusy).not.toHaveBeenCalled();
    expect(createCalendarEvent).not.toHaveBeenCalled();
    const data = await res.json();
    expect(data.appointment.eventId).toBe('evt-ja-existente');
  });
});
