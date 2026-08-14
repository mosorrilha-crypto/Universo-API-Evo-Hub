/**
 * GET/POST/PATCH/DELETE /api/admin/roadmap-items — substitui a lista de 4
 * cards fixos no código que existia na aba "Roadmap Técnico & Backlog",
 * impossível de editar pelo painel.
 */
import express from 'express';
import type { Server } from 'http';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createRoadmapRouter } from '../roadmap';
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
  app.use(createRoadmapRouter({ authenticateToken: makeAuth(role) as any }));
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

describe('GET/POST/PATCH/DELETE /api/admin/roadmap-items', () => {
  it('fluxo completo: cria, lista, atualiza status e apaga', async () => {
    ({ server, baseUrl } = await startServer('saas_admin'));

    const post = await fetch(`${baseUrl}/api/admin/roadmap-items`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Circuit breaker Evolution/Z-API', description: 'Failover automático', priority: 'alta' }),
    });
    expect(post.status).toBe(201);
    const postBody = await post.json();
    expect(postBody.item.title).toBe('Circuit breaker Evolution/Z-API');
    expect(postBody.item.status).toBe('pendente');
    const itemId = postBody.item.id;

    const list = await fetch(`${baseUrl}/api/admin/roadmap-items`);
    expect(list.status).toBe(200);
    const listBody = await list.json();
    expect(listBody.items).toHaveLength(1);

    const patch = await fetch(`${baseUrl}/api/admin/roadmap-items/${itemId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'concluido' }),
    });
    expect(patch.status).toBe(200);
    expect((await patch.json()).item.status).toBe('concluido');

    const del = await fetch(`${baseUrl}/api/admin/roadmap-items/${itemId}`, { method: 'DELETE' });
    expect(del.status).toBe(200);
    const listAfter = await (await fetch(`${baseUrl}/api/admin/roadmap-items`)).json();
    expect(listAfter.items).toHaveLength(0);
  });

  it('aceita item com imagem (data URI)', async () => {
    ({ server, baseUrl } = await startServer('saas_admin'));
    const post = await fetch(`${baseUrl}/api/admin/roadmap-items`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Mockup novo dashboard', description: '', priority: 'media', imageBase64: 'data:image/png;base64,QQ==' }),
    });
    expect(post.status).toBe(201);
    expect((await post.json()).item.imageBase64).toBe('data:image/png;base64,QQ==');
  });

  it('rejeita título vazio', async () => {
    ({ server, baseUrl } = await startServer('saas_admin'));
    const res = await fetch(`${baseUrl}/api/admin/roadmap-items`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: '   ', description: '' }),
    });
    expect(res.status).toBe(400);
  });

  it('rejeita imageBase64 que não é uma data URI de imagem', async () => {
    ({ server, baseUrl } = await startServer('saas_admin'));
    const res = await fetch(`${baseUrl}/api/admin/roadmap-items`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'X', imageBase64: 'nao-e-uma-data-uri' }),
    });
    expect(res.status).toBe(400);
  });

  it('rejeita priority/status inválidos', async () => {
    ({ server, baseUrl } = await startServer('saas_admin'));
    const badPriority = await fetch(`${baseUrl}/api/admin/roadmap-items`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'X', priority: 'urgentissimo' }),
    });
    expect(badPriority.status).toBe(400);
  });

  it('PATCH em item inexistente devolve 404', async () => {
    ({ server, baseUrl } = await startServer('saas_admin'));
    const res = await fetch(`${baseUrl}/api/admin/roadmap-items/id-fantasma`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'concluido' }),
    });
    expect(res.status).toBe(404);
  });

  it('admin comum (não saas_admin) é rejeitado com 403 em todas as rotas', async () => {
    ({ server, baseUrl } = await startServer('admin'));

    expect((await fetch(`${baseUrl}/api/admin/roadmap-items`)).status).toBe(403);
    expect(
      (
        await fetch(`${baseUrl}/api/admin/roadmap-items`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title: 'X' }),
        })
      ).status
    ).toBe(403);
    expect(
      (
        await fetch(`${baseUrl}/api/admin/roadmap-items/any-id`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: 'concluido' }),
        })
      ).status
    ).toBe(403);
    expect((await fetch(`${baseUrl}/api/admin/roadmap-items/any-id`, { method: 'DELETE' })).status).toBe(403);
  });
});
