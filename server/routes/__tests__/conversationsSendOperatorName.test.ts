/**
 * TASK-0368 (pedido direto, print real de conversa duplicada no painel):
 * POST /api/conversations/:phone/send precisa identificar QUAL operador
 * específico está mandando a mensagem (antes o painel só sabia dizer
 * "algum operador do tenant"), gravando o nome como snapshot na própria
 * mensagem (ver messageSentBy.test.ts pra cobertura no nível do store).
 */
import express from 'express';
import type { Server } from 'http';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { initDb } from '../../services/db';
import { createFakeSupabase } from '../../services/__tests__/fakeSupabase';

const sendWhatsAppTextMessage = vi.fn(async () => 'wamid-test-123');

vi.mock('../../services/metaSend', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../services/metaSend')>();
  return { ...actual, sendWhatsAppTextMessage };
});

const { createConversationsRouter } = await import('../conversations');

const TENANT_A = 'tenant-a';

let server: Server;
let baseUrl: string;
let supabase: ReturnType<typeof createFakeSupabase>;

function fakeAuthenticateToken(req: any, _res: any, next: any) {
  req.user = { id: 'op-monique', tenantId: TENANT_A, role: 'admin' };
  next();
}

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use(
    createConversationsRouter({
      authenticateToken: fakeAuthenticateToken as any,
      metaAccessToken: 'tok',
      jwtSecret: 'test-secret',
      metaPhoneNumberId: 'pn',
      supabaseUrl: 'https://fake.supabase.co',
      supabaseKey: 'fake-key',
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

beforeEach(() => {
  sendWhatsAppTextMessage.mockClear();
  supabase = createFakeSupabase({
    conversations: [{ id: 'conv-1', tenant_id: TENANT_A, phone: '595981111111', name: 'Cliente A', updated_at: new Date().toISOString(), geo_restriction: null }],
    operators: [{ id: 'op-monique', tenant_id: TENANT_A, name: 'Monique', email: 'monique@teste.com', role: 'admin', is_active: true }],
  });
  initDb(supabase);
});

describe('POST /api/conversations/:phone/send — identifica o operador (TASK-0368)', () => {
  it('grava o nome do operador autenticado na mensagem enviada', async () => {
    const res = await fetch(`${baseUrl}/api/conversations/595981111111/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: 'Qual é o teu nome?' }),
    });
    expect(res.status).toBe(200);

    // A resposta HTTP (conversation.messages) reaproveita getConversation,
    // que usa um embed relacional (`messages(...)`) que o fake de Supabase
    // dos testes não resolve (ver fakeSupabase.ts: select() ignora a string
    // de colunas/embeds) — cobertura real da leitura já feita à parte, via
    // getConversationMessagesPage, em messageSentBy.test.ts. Aqui valida o
    // que a rota de fato grava no banco, que é onde a lógica nova mora.
    const message = supabase.__tables.messages.find((m: any) => m.text === 'Qual é o teu nome?');
    expect(message?.sent_by).toBe('operator');
    expect(message?.operator_name).toBe('Monique');
  });

  it('sem operador correspondente (id não encontrado), envia normalmente com operator_name null', async () => {
    supabase = createFakeSupabase({
      conversations: [{ id: 'conv-1', tenant_id: TENANT_A, phone: '595981111111', name: 'Cliente A', updated_at: new Date().toISOString(), geo_restriction: null }],
      operators: [],
    });
    initDb(supabase);

    const res = await fetch(`${baseUrl}/api/conversations/595981111111/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: 'oi' }),
    });
    expect(res.status).toBe(200);
    const message = supabase.__tables.messages.find((m: any) => m.text === 'oi');
    expect(message?.sent_by).toBe('operator');
    expect(message?.operator_name).toBeNull();
  });
});
