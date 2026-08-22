/**
 * Issue #97 — operador escreve uma orientação no card do escalonamento em
 * vez de assumir a conversa pessoalmente; a IA retoma o atendimento com o
 * cliente a partir dela. Dentro da janela de 24h da Meta (desde a última
 * mensagem do lead): responde de imediato, texto livre. Fora da janela:
 * manda o template de reengajamento e deixa a orientação pendente.
 */
import express from 'express';
import type { Server } from 'http';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
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
        ? JSON.stringify({ approved: true, severity: 'low', reason: 'Mensagem segue a orientação do operador.' })
        : 'Oi! Passando pra te dizer que já está tudo certo, qualquer coisa me chama 😊',
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

function seed(leadMessageAgoMs: number | null) {
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
        reason: 'Cliente sumiu no meio da negociação',
        last_message: null,
        country: 'Paraguay',
        resolved: false,
        created_at: new Date().toISOString(),
        operator_reply: null,
        operator_reply_at: null,
        operator_reply_consumed_at: null,
      },
    ],
  });
  initDb(supabase);
}

describe('POST /api/escalations/:id/operator-reply', () => {
  it('dentro da janela de 24h: IA responde de imediato com texto livre e resolve o escalonamento', async () => {
    seed(60 * 60 * 1000); // lead mandou mensagem há 1h

    let capturedBody: any;
    global.fetch = vi.fn(async (url: any, options?: any) => {
      if (String(url).startsWith(baseUrl)) return realFetch(url, options);
      capturedBody = JSON.parse(options.body);
      return { ok: true, json: async () => ({}) } as any;
    }) as any;

    const res = await fetch(`${baseUrl}/api/escalations/esc-1/operator-reply`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reply: 'Diz pra ela que o horário de sábado 14h ainda está livre.' }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();

    expect(data.outcome).toMatchObject({ sent: true, viaTemplate: false });
    expect(capturedBody.type).toBe('text');
    expect(fakeAi.models.generateContent).toHaveBeenCalledTimes(2);

    const escRow = supabase.__tables.escalations.find((e: any) => e.id === 'esc-1');
    expect(escRow.resolved).toBe(true);
    expect(escRow.operator_reply_consumed_at).toBeTruthy();

    const messages = supabase.__tables.messages.filter((m: any) => m.conversation_id === 'conv-1');
    expect(messages.some((m: any) => m.sender === 'agent' && m.sent_by === 'ai')).toBe(true);
  });

  it('fora da janela de 24h: manda o template de reengajamento e deixa a orientação pendente (não resolve)', async () => {
    seed(30 * 60 * 60 * 1000); // lead mandou mensagem há 30h — janela já fechou

    let capturedBody: any;
    global.fetch = vi.fn(async (url: any, options?: any) => {
      if (String(url).startsWith(baseUrl)) return realFetch(url, options);
      capturedBody = JSON.parse(options.body);
      return { ok: true, json: async () => ({}) } as any;
    }) as any;

    const res = await fetch(`${baseUrl}/api/escalations/esc-1/operator-reply`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reply: 'Diz pra ela que o horário de sábado 14h ainda está livre.' }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();

    expect(data.outcome).toMatchObject({ sent: true, viaTemplate: true });
    expect(capturedBody.type).toBe('template');
    expect(capturedBody.template.name).toBe('retomada_atendimento');
    expect(fakeAi.models.generateContent).not.toHaveBeenCalled();

    const escRow = supabase.__tables.escalations.find((e: any) => e.id === 'esc-1');
    expect(escRow.resolved).toBe(false);
    expect(escRow.operator_reply).toBe('Diz pra ela que o horário de sábado 14h ainda está livre.');
    expect(escRow.operator_reply_consumed_at).toBeNull();
  });

  it('sem nenhuma mensagem do lead ainda (conversa nunca teve mensagem dele): trata como fora da janela', async () => {
    seed(null);
    global.fetch = vi.fn(async (url: any, options?: any) => (String(url).startsWith(baseUrl) ? realFetch(url, options) : { ok: true, json: async () => ({}) })) as any;

    const res = await fetch(`${baseUrl}/api/escalations/esc-1/operator-reply`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reply: 'Orientação qualquer.' }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.outcome).toMatchObject({ sent: true, viaTemplate: true });
  });

  it('400 quando "reply" vem vazio', async () => {
    seed(60 * 60 * 1000);
    const res = await fetch(`${baseUrl}/api/escalations/esc-1/operator-reply`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reply: '   ' }),
    });
    expect(res.status).toBe(400);
  });

  it('404 pra escalonamento inexistente', async () => {
    seed(60 * 60 * 1000);
    const res = await fetch(`${baseUrl}/api/escalations/nao-existe/operator-reply`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reply: 'Orientação qualquer.' }),
    });
    expect(res.status).toBe(404);
  });
});

describe('GET /api/escalations — timer de janela de 24h (issue #97)', () => {
  it('inclui withinServiceWindow/serviceWindowExpiresAt pros escalonamentos pendentes', async () => {
    seed(60 * 60 * 1000);
    const res = await fetch(`${baseUrl}/api/escalations`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.escalations[0].withinServiceWindow).toBe(true);
    expect(data.escalations[0].serviceWindowExpiresAt).toBeTruthy();
  });
});
