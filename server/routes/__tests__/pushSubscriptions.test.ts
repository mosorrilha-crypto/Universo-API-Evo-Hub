/**
 * POST /api/push/subscribe, /unsubscribe e GET /api/push/vapid-public-key —
 * infraestrutura de Web Push do PWA do atendente (issue #159).
 */
import express from 'express';
import type { Server } from 'http';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createPushSubscriptionsRouter } from '../pushSubscriptions';
import { initDb } from '../../services/db';
import { createFakeSupabase } from '../../services/__tests__/fakeSupabase';

const TENANT_A = 'tenant-a';
const OPERATOR_A = 'op-1';

let server: Server;
let baseUrl: string;
let supabase: ReturnType<typeof createFakeSupabase>;

function fakeAuthenticateToken(req: any, _res: any, next: any) {
  req.user = { id: OPERATOR_A, tenantId: TENANT_A, role: 'admin' };
  next();
}

function buildApp(vapidPublicKey?: string) {
  const app = express();
  app.use(express.json());
  app.use(createPushSubscriptionsRouter({ authenticateToken: fakeAuthenticateToken as any, vapidPublicKey }));
  app.use((err: any, _req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (res.headersSent) return next(err);
    res.status(500).json({ error: err?.message || 'Erro interno do servidor.' });
  });
  return app;
}

beforeAll(async () => {
  const app = buildApp('vapid-public-key-de-teste');
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
  supabase = createFakeSupabase();
  initDb(supabase);
});

describe('GET /api/push/vapid-public-key', () => {
  it('devolve a chave pública configurada', async () => {
    const res = await fetch(`${baseUrl}/api/push/vapid-public-key`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.publicKey).toBe('vapid-public-key-de-teste');
  });

  it('devolve 503 quando o servidor não tem VAPID configurado', async () => {
    const appSemVapid = buildApp(undefined);
    const s = await new Promise<Server>((resolve) => {
      const srv = appSemVapid.listen(0, () => resolve(srv));
    });
    const address = s.address();
    const port = typeof address === 'object' && address ? address.port : 0;

    const res = await fetch(`http://127.0.0.1:${port}/api/push/vapid-public-key`);
    expect(res.status).toBe(503);
    s.close();
  });
});

describe('POST /api/push/subscribe', () => {
  it('grava a assinatura vinculada ao tenant/operador da sessão autenticada', async () => {
    const res = await fetch(`${baseUrl}/api/push/subscribe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        subscription: { endpoint: 'https://push.example/x', keys: { p256dh: 'p', auth: 'a' } },
        userAgent: 'Mozilla/5.0',
      }),
    });
    expect(res.status).toBe(200);

    expect(supabase.__tables.push_subscriptions).toHaveLength(1);
    expect(supabase.__tables.push_subscriptions[0]).toMatchObject({
      tenant_id: TENANT_A,
      operator_id: OPERATOR_A,
      endpoint: 'https://push.example/x',
      p256dh: 'p',
      auth: 'a',
      user_agent: 'Mozilla/5.0',
    });
  });

  it('rejeita subscription sem endpoint/keys', async () => {
    const res = await fetch(`${baseUrl}/api/push/subscribe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ subscription: { endpoint: 'https://push.example/x' } }),
    });
    expect(res.status).toBe(400);
    expect(supabase.__tables.push_subscriptions ?? []).toHaveLength(0);
  });
});

describe('POST /api/push/unsubscribe', () => {
  it('remove a assinatura do tenant pelo endpoint', async () => {
    await fetch(`${baseUrl}/api/push/subscribe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ subscription: { endpoint: 'https://push.example/x', keys: { p256dh: 'p', auth: 'a' } } }),
    });

    const res = await fetch(`${baseUrl}/api/push/unsubscribe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ endpoint: 'https://push.example/x' }),
    });
    expect(res.status).toBe(200);
    expect(supabase.__tables.push_subscriptions).toHaveLength(0);
  });
});
