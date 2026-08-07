/**
 * Ações de mensagem — responder, encaminhar, reagir, editar
 * (WhatsAppLeadsSim.tsx hoje só manda/apaga mensagem). Cobre os três
 * pontos críticos do plano do card: PATCH de edição rejeita mensagem
 * sender='lead' (nunca falsificar o que o cliente disse), forward só
 * resolve mensagem/destino dentro do tenant do JWT (nunca cross-tenant), e
 * react faz upsert por ator (reagir de novo troca a reação anterior, não
 * acumula).
 */
import express from 'express';
import type { Server } from 'http';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createConversationsRouter } from '../conversations';
import { initDb } from '../../services/db';
import { createFakeSupabase } from '../../services/__tests__/fakeSupabase';

const TENANT_A = 'tenant-a';
const TENANT_B = 'tenant-b';

let server: Server;
let baseUrl: string;
let supabase: ReturnType<typeof createFakeSupabase>;

function fakeAuthenticateToken(req: any, _res: any, next: any) {
  req.user = { id: 'op-1', tenantId: TENANT_A, role: 'admin' };
  next();
}

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use(
    createConversationsRouter({
      authenticateToken: fakeAuthenticateToken as any,
      metaAccessToken: 'tok',
      metaPhoneNumberId: 'pn',
    })
  );
  // Mesmo middleware de erro global do server.ts real.
  app.use((err: any, _req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (res.headersSent) return next(err);
    res.status(500).json({ error: err?.message || 'Erro interno do servidor.' });
  });
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

beforeEach(() => {
  const now = new Date().toISOString();
  supabase = createFakeSupabase({
    conversations: [
      { id: 'conv-1', tenant_id: TENANT_A, phone: '595981111111', name: 'Cliente A', updated_at: now, geo_restriction: null },
      { id: 'conv-2', tenant_id: TENANT_A, phone: '595982222222', name: 'Cliente B', updated_at: now, geo_restriction: null },
      { id: 'conv-x', tenant_id: TENANT_B, phone: '595989999999', name: 'Outro tenant', updated_at: now, geo_restriction: null },
    ],
    messages: [
      { id: 'msg-lead-1', tenant_id: TENANT_A, conversation_id: 'conv-1', sender: 'lead', type: 'text', text: 'Oi, tudo bem?', created_at: now, reply_to_message_id: null, forwarded_from_message_id: null, edited_at: null, reactions: null },
      { id: 'msg-agent-1', tenant_id: TENANT_A, conversation_id: 'conv-1', sender: 'agent', type: 'text', text: 'Olá! Tudo ótimo.', created_at: now, reply_to_message_id: null, forwarded_from_message_id: null, edited_at: null, reactions: null },
      { id: 'msg-other-tenant-1', tenant_id: TENANT_B, conversation_id: 'conv-x', sender: 'agent', type: 'text', text: 'Mensagem de outro tenant', created_at: now, reply_to_message_id: null, forwarded_from_message_id: null, edited_at: null, reactions: null },
    ],
  });
  initDb(supabase);
});

describe('PATCH /api/conversations/:phone/messages/:messageId — editar mensagem', () => {
  it('rejeita (403) editar mensagem do lead — nunca falsificar o que o cliente disse', async () => {
    const res = await fetch(`${baseUrl}/api/conversations/595981111111/messages/msg-lead-1`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: 'texto forjado' }),
    });
    expect(res.status).toBe(403);
    const original = supabase.__tables.messages.find((m: any) => m.id === 'msg-lead-1');
    expect(original.text).toBe('Oi, tudo bem?');
  });

  it('edita mensagem do agente e marca edited_at', async () => {
    const res = await fetch(`${baseUrl}/api/conversations/595981111111/messages/msg-agent-1`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: 'Olá! Tudo ótimo, e você?' }),
    });
    expect(res.status).toBe(200);
    const updated = supabase.__tables.messages.find((m: any) => m.id === 'msg-agent-1');
    expect(updated.text).toBe('Olá! Tudo ótimo, e você?');
    expect(updated.edited_at).toBeTruthy();
  });

  it('404 pra mensagem inexistente', async () => {
    const res = await fetch(`${baseUrl}/api/conversations/595981111111/messages/msg-inexistente`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: 'qualquer coisa' }),
    });
    expect(res.status).toBe(404);
  });
});

describe('POST /api/conversations/:phone/messages/:messageId/react — reagir', () => {
  it('faz upsert por ator: reagir 2x troca a reação anterior, não acumula', async () => {
    const first = await fetch(`${baseUrl}/api/conversations/595981111111/messages/msg-agent-1/react`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ emoji: '👍' }),
    });
    expect(first.status).toBe(200);

    const second = await fetch(`${baseUrl}/api/conversations/595981111111/messages/msg-agent-1/react`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ emoji: '❤️' }),
    });
    expect(second.status).toBe(200);
    const data = await second.json();
    expect(data.reactions).toHaveLength(1);
    expect(data.reactions[0]).toMatchObject({ emoji: '❤️', by: 'agent' });

    const stored = supabase.__tables.messages.find((m: any) => m.id === 'msg-agent-1');
    expect(stored.reactions).toHaveLength(1);
  });
});

describe('POST /api/conversations/:phone/messages/:messageId/forward — encaminhar', () => {
  it('encaminha a mensagem pra outro contato do mesmo tenant', async () => {
    const res = await fetch(`${baseUrl}/api/conversations/595981111111/messages/msg-agent-1/forward`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ toPhone: '595982222222' }),
    });
    expect(res.status).toBe(200);

    const forwarded = supabase.__tables.messages.find((m: any) => m.forwarded_from_message_id === 'msg-agent-1');
    expect(forwarded).toBeTruthy();
    expect(forwarded.conversation_id).toBe('conv-2');
    expect(forwarded.sender).toBe('agent');
    expect(forwarded.text).toBe('Olá! Tudo ótimo.');
  });

  it('nunca encaminha mensagem de outro tenant — messageId é resolvido só dentro do tenant do JWT', async () => {
    const res = await fetch(`${baseUrl}/api/conversations/595981111111/messages/msg-other-tenant-1/forward`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ toPhone: '595982222222' }),
    });
    expect(res.status).toBe(500);
    const leaked = supabase.__tables.messages.find((m: any) => m.forwarded_from_message_id === 'msg-other-tenant-1');
    expect(leaked).toBeUndefined();
  });
});
