/**
 * PATCH /api/conversations/:phone/state — campo "aiBlocked" (bloquear IA de
 * um lead específico). Pedido real do operador: um lead claramente não
 * qualificado (fora do público-alvo, mandando fotos/mensagens aleatórias)
 * ficava "assediando" e a IA continuava respondendo automaticamente igual a
 * qualquer outro lead — diferente de agent_status (pausa TODO o tenant),
 * isso pausa só esse número, pelo menu ⋮ da lista.
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
      { id: 'conv-1', tenant_id: TENANT_A, phone: '595985407441', name: 'Lead insistente', updated_at: now, geo_restriction: null, ai_blocked_at: null },
    ],
    messages: [],
  });
  initDb(supabase);
});

describe('PATCH /api/conversations/:phone/state — aiBlocked', () => {
  it('bloqueia a IA pra esse lead', async () => {
    const res = await fetch(`${baseUrl}/api/conversations/595985407441/state`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ aiBlocked: true }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.conversation.aiBlockedAt).toBeTruthy();

    const stored = supabase.__tables.conversations.find((c: any) => c.id === 'conv-1');
    expect(stored.ai_blocked_at).toBeTruthy();
  });

  it('desbloqueia de volta (aiBlocked: false limpa ai_blocked_at)', async () => {
    await fetch(`${baseUrl}/api/conversations/595985407441/state`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ aiBlocked: true }),
    });

    const res = await fetch(`${baseUrl}/api/conversations/595985407441/state`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ aiBlocked: false }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.conversation.aiBlockedAt).toBeUndefined();

    const stored = supabase.__tables.conversations.find((c: any) => c.id === 'conv-1');
    expect(stored.ai_blocked_at).toBeNull();
  });

  it('404 pra conversa inexistente', async () => {
    const res = await fetch(`${baseUrl}/api/conversations/000000000/state`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ aiBlocked: true }),
    });
    expect(res.status).toBe(404);
  });
});
