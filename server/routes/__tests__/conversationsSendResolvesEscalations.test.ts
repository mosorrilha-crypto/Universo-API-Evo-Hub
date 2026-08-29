/**
 * Continuação da TASK-0151 (29/08/2026) — achado real de auditoria: quando
 * um operador responde manualmente pelo painel (POST .../send), nenhum
 * escalonamento aberto pra esse telefone fechava sozinho, mesmo já resolvido
 * na prática pelo humano. Ver resolveOpenEscalationsAfterManualReply em
 * conversations.ts.
 */
import express from 'express';
import type { Server } from 'http';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { createConversationsRouter } from '../conversations';
import { initDb } from '../../services/db';
import { createFakeSupabase } from '../../services/__tests__/fakeSupabase';

const TENANT_ID = 'tenant-a';
const OTHER_TENANT_ID = 'tenant-b';
const PHONE = '595981111111';
const realFetch = global.fetch;

let server: Server;
let baseUrl: string;
let supabase: ReturnType<typeof createFakeSupabase>;

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
    })
  );
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => resolve());
  });
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  baseUrl = `http://127.0.0.1:${port}`;
});

afterAll(() => server.close());

afterEach(() => {
  global.fetch = realFetch;
});

function stubMetaSendSuccess() {
  global.fetch = vi.fn(async (url: any, options?: any) => {
    if (String(url).startsWith(baseUrl)) return realFetch(url, options);
    return { ok: true, json: async () => ({ messages: [{ id: 'wamid.fake' }] }) } as any;
  }) as any;
}

function seed() {
  const now = new Date().toISOString();
  supabase = createFakeSupabase({
    tenants: [{ id: TENANT_ID, name: 'Studio Teste' }],
    conversations: [
      { id: 'conv-1', tenant_id: TENANT_ID, phone: PHONE, name: 'Cliente Teste', updated_at: now, last_read_at: '1970-01-01T00:00:00.000Z', messages: [] },
    ],
    escalations: [
      {
        id: 'esc-blocked',
        tenant_id: TENANT_ID,
        phone: PHONE,
        contact_name: 'Cliente Teste',
        reason: 'Revisor pré-envio bloqueou a resposta automática.',
        last_message: 'Hola, ¿cuánto dura el servicio?',
        blocked_draft: '¿Agendamos tu turno?',
        country: 'Paraguay',
        resolved: false,
        created_at: now,
        operator_reply: null,
        operator_reply_at: null,
        operator_reply_consumed_at: null,
        kind: 'general',
      },
      {
        id: 'esc-payment',
        tenant_id: TENANT_ID,
        phone: PHONE,
        contact_name: 'Cliente Teste',
        reason: 'Comprovante de pagamento recebido, aguardando revisão humana.',
        last_message: null,
        country: 'Paraguay',
        resolved: false,
        created_at: now,
        operator_reply: null,
        operator_reply_at: null,
        operator_reply_consumed_at: null,
        kind: 'payment_proof',
      },
      {
        id: 'esc-other-phone',
        tenant_id: TENANT_ID,
        phone: '595989999999',
        contact_name: 'Outro Cliente',
        reason: 'Caso de outro telefone',
        last_message: null,
        country: 'Paraguay',
        resolved: false,
        created_at: now,
        operator_reply: null,
        operator_reply_at: null,
        operator_reply_consumed_at: null,
        kind: 'general',
      },
      {
        id: 'esc-other-tenant',
        tenant_id: OTHER_TENANT_ID,
        phone: PHONE,
        contact_name: 'Cliente Teste',
        reason: 'Caso de outro tenant',
        last_message: null,
        country: 'Paraguay',
        resolved: false,
        created_at: now,
        operator_reply: null,
        operator_reply_at: null,
        operator_reply_consumed_at: null,
        kind: 'general',
      },
    ],
  });
  initDb(supabase);
}

describe('POST /api/conversations/:phone/send — auto-resolve de escalonamentos', () => {
  it('resolve escalonamentos abertos (não pagamento) deste telefone ao enviar uma resposta manual', async () => {
    seed();
    stubMetaSendSuccess();

    const res = await fetch(`${baseUrl}/api/conversations/${PHONE}/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: '¿te decidiste por algún servicio o necesitás que te ayude a elegir?' }),
    });
    expect(res.status).toBe(200);

    const blocked = supabase.__tables.escalations.find((e: any) => e.id === 'esc-blocked');
    expect(blocked.resolved).toBe(true);
    expect(blocked.resolution_code).toBe('operator_manual_reply');
  });

  it('nunca auto-resolve um escalonamento de comprovante de pagamento', async () => {
    seed();
    stubMetaSendSuccess();

    await fetch(`${baseUrl}/api/conversations/${PHONE}/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: 'Oi!' }),
    });

    const payment = supabase.__tables.escalations.find((e: any) => e.id === 'esc-payment');
    expect(payment.resolved).toBe(false);
  });

  it('não toca escalonamento de outro telefone nem de outro tenant', async () => {
    seed();
    stubMetaSendSuccess();

    await fetch(`${baseUrl}/api/conversations/${PHONE}/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: 'Oi!' }),
    });

    expect(supabase.__tables.escalations.find((e: any) => e.id === 'esc-other-phone').resolved).toBe(false);
    expect(supabase.__tables.escalations.find((e: any) => e.id === 'esc-other-tenant').resolved).toBe(false);
  });

  it('pula o escalonamento indicado via escalationId (fluxo "Aprovar e enviar")', async () => {
    seed();
    stubMetaSendSuccess();

    const res = await fetch(`${baseUrl}/api/conversations/${PHONE}/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: '¿Agendamos tu turno?', escalationId: 'esc-blocked' }),
    });
    expect(res.status).toBe(200);

    const blocked = supabase.__tables.escalations.find((e: any) => e.id === 'esc-blocked');
    expect(blocked.resolved).toBe(false);

    // approve-and-resolve, chamado em seguida pelo painel, ainda consegue resolver — não bateu em 409.
    const approveRes = await fetch(`${baseUrl}/api/escalations/esc-blocked/approve-and-resolve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ approvedReply: '¿Agendamos tu turno?' }),
    });
    expect(approveRes.status).toBe(200);
  });
});
