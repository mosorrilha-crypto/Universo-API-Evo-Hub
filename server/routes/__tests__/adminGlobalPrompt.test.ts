/**
 * GET/POST /api/admin/global-prompt — Camada 1 (Global) do prompt do agente
 * editável por saas_admin sem PR+deploy (ver globalPromptStore.ts). Só
 * saas_admin; qualquer outro papel é rejeitado pelo próprio requireRole.
 */
import express from 'express';
import type { Server } from 'http';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createAdminRouter } from '../admin';
import { createFakeSupabase } from '../../services/__tests__/fakeSupabase';
import { initDb } from '../../services/db';

let server: Server;
let baseUrl: string;
let supabase: ReturnType<typeof createFakeSupabase>;

function makeAuth(role: string) {
  return (req: any, _res: any, next: any) => {
    req.user = { id: 'op-1', tenantId: 'tenant-a', role };
    next();
  };
}

function startServer(role: string) {
  const app = express();
  app.use(express.json());
  app.use(
    createAdminRouter({
      authenticateToken: makeAuth(role) as any,
      supabase: supabase as any,
      publicBaseUrl: 'https://universo.example.com',
    })
  );
  return new Promise<{ server: Server; baseUrl: string }>((resolve) => {
    const s = app.listen(0, () => {
      const address = s.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      resolve({ server: s, baseUrl: `http://127.0.0.1:${port}` });
    });
  });
}

beforeEach(() => {
  supabase = createFakeSupabase();
  initDb(supabase as any);
});

afterEach(async () => {
  if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe('GET/POST /api/admin/global-prompt', () => {
  it('saas_admin: GET devolve content null quando nunca foi salvo, POST grava, GET seguinte devolve o novo texto', async () => {
    ({ server, baseUrl } = await startServer('saas_admin'));

    const getBefore = await fetch(`${baseUrl}/api/admin/global-prompt`);
    expect(getBefore.status).toBe(200);
    expect((await getBefore.json()).content).toBeNull();

    const post = await fetch(`${baseUrl}/api/admin/global-prompt`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: 'Regra nova de teste.' }),
    });
    expect(post.status).toBe(200);
    const postBody = await post.json();
    expect(postBody.content).toBe('Regra nova de teste.');
    expect(postBody.updatedBy).toBe('op-1');

    const getAfter = await fetch(`${baseUrl}/api/admin/global-prompt`);
    expect((await getAfter.json()).content).toBe('Regra nova de teste.');
  });

  it('POST com content: null reseta pro padrão', async () => {
    ({ server, baseUrl } = await startServer('saas_admin'));
    await fetch(`${baseUrl}/api/admin/global-prompt`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: 'Temporário' }),
    });

    const reset = await fetch(`${baseUrl}/api/admin/global-prompt`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: null }),
    });
    expect(reset.status).toBe(200);
    expect((await reset.json()).content).toBeNull();
  });

  it('rejeita content que não é string nem null', async () => {
    ({ server, baseUrl } = await startServer('saas_admin'));
    const res = await fetch(`${baseUrl}/api/admin/global-prompt`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: 42 }),
    });
    expect(res.status).toBe(400);
  });

  it('admin comum (não saas_admin) é rejeitado com 403 tanto no GET quanto no POST', async () => {
    ({ server, baseUrl } = await startServer('admin'));

    const getRes = await fetch(`${baseUrl}/api/admin/global-prompt`);
    expect(getRes.status).toBe(403);

    const postRes = await fetch(`${baseUrl}/api/admin/global-prompt`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: 'tentativa' }),
    });
    expect(postRes.status).toBe(403);
  });
});
