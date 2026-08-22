/**
 * Unificação da verificação de pagamento no card do escalonamento (pedido
 * real do dono do produto, 12/08/2026): antes disso existiam dois lugares
 * desconectados pro mesmo comprovante — o banner Confirmar/Rejeitar dentro
 * da conversa (verify-payment) e o escalonamento gerado automaticamente
 * pra esse mesmo comprovante (kind: 'payment_proof', ver webhooks.ts).
 * POST /api/escalations/:id/resolve-payment junta os dois: marca o
 * pagamento e, se o operador escreveu um motivo (obrigatório em rejeições
 * pra explicar pro cliente), reusa o mesmo pipeline de orientação da IA do
 * issue #97 (operator-reply) pra já avisar o cliente.
 */
import express from 'express';
import type { Server } from 'http';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { createConversationsRouter } from '../conversations';
import { initDb } from '../../services/db';
import { createFakeSupabase } from '../../services/__tests__/fakeSupabase';

const TENANT_ID = 'tenant-a';
const PHONE = '595981111111';
const realFetch = global.fetch;

let server: Server;
let baseUrl: string;
let supabase: ReturnType<typeof createFakeSupabase>;

const fakeAi = {
  models: {
    generateContent: vi.fn(async (request: any) => ({
      text: typeof request?.contents === 'string' && request.contents.includes('REVISOR DE SEGURANÇA')
        ? JSON.stringify({ approved: true, severity: 'low', reason: 'Rascunho alinhado à orientação humana.' })
        : 'Oi! Sobre o pagamento, deu uma diferença aqui, pode conferir?',
    })),
  },
};

function fakeAuthenticateToken(req: any, _res: any, next: any) {
  req.user = { id: 'op-1', tenantId: TENANT_ID, role: 'admin' };
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
      getAi: () => fakeAi as any,
    })
  );
  await new Promise<void>((resolve) => {
    server = app.listen(0, resolve);
  });
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  baseUrl = `http://127.0.0.1:${port}`;
});

afterAll(() => {
  server.close();
});

afterEach(() => {
  vi.unstubAllGlobals();
  global.fetch = realFetch;
  fakeAi.models.generateContent.mockClear();
});

function seed(opts: { leadMessageAgoMs: number | null; hasAppointment?: boolean }) {
  const { leadMessageAgoMs, hasAppointment = true } = opts;
  const messages = leadMessageAgoMs === null
    ? []
    : [{ id: 'm-1', sender: 'lead', type: 'text', text: 'Oi', created_at: new Date(Date.now() - leadMessageAgoMs).toISOString(), reply_to_message_id: null, forwarded_from_message_id: null, edited_at: null, reactions: null, sent_by: null }];

  supabase = createFakeSupabase({
    tenants: [{ id: TENANT_ID, name: 'Studio Bella Vita' }],
    conversations: [
      { id: 'conv-1', tenant_id: TENANT_ID, phone: PHONE, name: 'Cliente Teste', updated_at: new Date().toISOString(), last_read_at: '1970-01-01T00:00:00.000Z', messages },
    ],
    escalations: [
      {
        id: 'esc-1',
        tenant_id: TENANT_ID,
        phone: PHONE,
        contact_name: 'Cliente Teste',
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
    appointments: hasAppointment
      ? [
          {
            tenant_id: TENANT_ID,
            phone: PHONE,
            event_id: 'evt-1',
            summary: 'Corte + escova',
            start_iso: new Date(Date.now() + 3600_000).toISOString(),
            end_iso: new Date(Date.now() + 7200_000).toISOString(),
            created_at: new Date().toISOString(),
            payment_status: 'pending_verification',
            payment_proof_message_id: 'wamid-1',
            payment_verified_by: null,
            payment_verified_at: null,
            payment_pending_since: new Date().toISOString(),
            payment_pending_alerted_at: null,
          },
        ]
      : [],
  });
  initDb(supabase);
}

function stubOutboundFetch() {
  let capturedBody: any;
  global.fetch = vi.fn(async (url: any, options?: any) => {
    if (String(url).startsWith(baseUrl)) return realFetch(url, options);
    capturedBody = JSON.parse(options.body);
    return { ok: true, json: async () => ({}) } as any;
  }) as any;
  return () => capturedBody;
}

describe('POST /api/escalations/:id/resolve-payment', () => {
  it('confirma o pagamento sem "reply": só marca e resolve o card, sem falar com a IA', async () => {
    seed({ leadMessageAgoMs: 60 * 60 * 1000 });

    const res = await fetch(`${baseUrl}/api/escalations/esc-1/resolve-payment`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone: PHONE, status: 'verified' }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();

    expect(data.appointment.paymentStatus).toBe('verified');
    expect(data.outcome).toBeNull();
    expect(data.escalation.resolved).toBe(true);
    expect(fakeAi.models.generateContent).not.toHaveBeenCalled();

    const apptRow = supabase.__tables.appointments.find((a: any) => a.phone === PHONE);
    expect(apptRow.payment_verified_by).toBe('op-1');
  });

  it('rejeita com motivo dentro da janela de 24h: marca rejeitado, avisa o cliente de imediato e resolve o card', async () => {
    seed({ leadMessageAgoMs: 60 * 60 * 1000 });
    const getCapturedBody = stubOutboundFetch();

    const res = await fetch(`${baseUrl}/api/escalations/esc-1/resolve-payment`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone: PHONE, status: 'rejected', reply: 'O valor do comprovante veio menor que o combinado.' }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();

    expect(data.appointment.paymentStatus).toBe('rejected');
    expect(data.outcome).toMatchObject({ sent: true, viaTemplate: false });
    expect(getCapturedBody().type).toBe('text');
    expect(fakeAi.models.generateContent).toHaveBeenCalledTimes(2);

    const escRow = supabase.__tables.escalations.find((e: any) => e.id === 'esc-1');
    expect(escRow.resolved).toBe(true);
    expect(escRow.operator_reply).toBe('O valor do comprovante veio menor que o combinado.');
  });

  it('rejeita com motivo fora da janela de 24h: manda template de reengajamento e deixa o card pendente', async () => {
    seed({ leadMessageAgoMs: 30 * 60 * 60 * 1000 });
    const getCapturedBody = stubOutboundFetch();

    const res = await fetch(`${baseUrl}/api/escalations/esc-1/resolve-payment`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone: PHONE, status: 'rejected', reply: 'Comprovante ilegível, pede pra reenviar.' }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();

    expect(data.appointment.paymentStatus).toBe('rejected');
    expect(data.outcome).toMatchObject({ sent: true, viaTemplate: true });
    expect(getCapturedBody().template.name).toBe('retomada_atendimento');
    expect(fakeAi.models.generateContent).not.toHaveBeenCalled();

    const escRow = supabase.__tables.escalations.find((e: any) => e.id === 'esc-1');
    expect(escRow.resolved).toBe(false);
    expect(escRow.operator_reply).toBe('Comprovante ilegível, pede pra reenviar.');
  });

  it('400 quando "phone" não vem', async () => {
    seed({ leadMessageAgoMs: 60 * 60 * 1000 });
    const res = await fetch(`${baseUrl}/api/escalations/esc-1/resolve-payment`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'verified' }),
    });
    expect(res.status).toBe(400);
  });

  it('400 quando "status" não é "verified" nem "rejected"', async () => {
    seed({ leadMessageAgoMs: 60 * 60 * 1000 });
    const res = await fetch(`${baseUrl}/api/escalations/esc-1/resolve-payment`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone: PHONE, status: 'maybe' }),
    });
    expect(res.status).toBe(400);
  });

  it('404 quando não há agendamento ativo pra esse telefone', async () => {
    seed({ leadMessageAgoMs: 60 * 60 * 1000, hasAppointment: false });
    const res = await fetch(`${baseUrl}/api/escalations/esc-1/resolve-payment`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone: PHONE, status: 'verified' }),
    });
    expect(res.status).toBe(404);
  });

  it('404 quando o escalonamento não existe (agendamento já foi marcado, mas o card não)', async () => {
    seed({ leadMessageAgoMs: 60 * 60 * 1000 });
    const res = await fetch(`${baseUrl}/api/escalations/nao-existe/resolve-payment`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone: PHONE, status: 'verified' }),
    });
    expect(res.status).toBe(404);
  });
});
