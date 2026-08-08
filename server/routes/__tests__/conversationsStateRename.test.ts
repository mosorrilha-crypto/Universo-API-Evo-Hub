/**
 * PATCH /api/conversations/:phone/state — campo "name" (identificar o lead).
 * Achado real em produção: leads chegam só com o número de telefone
 * ("595985407441") como nome porque a Meta só manda o nome de perfil de
 * WhatsApp quando o cliente definiu um — o operador precisa poder anotar o
 * nome de verdade do cliente pelo menu ⋮ da lista.
 */
import express from 'express';
import type { Server } from 'http';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createConversationsRouter } from '../conversations';
import { initDb } from '../../services/db';
import { createFakeSupabase } from '../../services/__tests__/fakeSupabase';

const TENANT_A = 'tenant-a';

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
      { id: 'conv-1', tenant_id: TENANT_A, phone: '595985407441', name: null, updated_at: now, geo_restriction: null },
    ],
    messages: [],
  });
  initDb(supabase);
});

describe('PATCH /api/conversations/:phone/state — name', () => {
  it('identifica o lead: troca o "nome" (número cru) pelo nome de verdade do contato', async () => {
    const res = await fetch(`${baseUrl}/api/conversations/595985407441/state`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Claudia' }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.conversation.name).toBe('Claudia');

    const stored = supabase.__tables.conversations.find((c: any) => c.id === 'conv-1');
    expect(stored.name).toBe('Claudia');
  });

  it('rejeita (400) nome vazio/só espaço — nunca apaga a identificação em silêncio', async () => {
    const res = await fetch(`${baseUrl}/api/conversations/595985407441/state`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: '   ' }),
    });
    expect(res.status).toBe(400);
    const stored = supabase.__tables.conversations.find((c: any) => c.id === 'conv-1');
    expect(stored.name).toBeNull();
  });

  it('apara espaços nas pontas antes de salvar', async () => {
    const res = await fetch(`${baseUrl}/api/conversations/595985407441/state`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: '  Claudia Souza  ' }),
    });
    expect(res.status).toBe(200);
    const stored = supabase.__tables.conversations.find((c: any) => c.id === 'conv-1');
    expect(stored.name).toBe('Claudia Souza');
  });

  it('404 pra conversa inexistente', async () => {
    const res = await fetch(`${baseUrl}/api/conversations/000000000/state`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Alguém' }),
    });
    expect(res.status).toBe(404);
  });
});
