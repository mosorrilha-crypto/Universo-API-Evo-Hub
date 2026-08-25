/**
 * PATCH /api/admin/operators/:id — TASK-0070, pedido direto de chat
 * ("trocar login de acesso e senha" na tela de gestão de tenants). Estende
 * a rota já existente (que só trocava `role`) pra aceitar email/name/
 * password também, mantendo a mesma regra de escopo (admin comum só edita
 * dentro do próprio tenant).
 */
import bcrypt from 'bcrypt';
import express from 'express';
import type { Server } from 'http';
import { afterEach, describe, expect, it } from 'vitest';
import { createAdminRouter } from '../admin';
import { createFakeSupabase } from '../../services/__tests__/fakeSupabase';

let server: Server;
let baseUrl: string;
let supabase: ReturnType<typeof createFakeSupabase>;

function makeAuth(role: string, tenantId = 'tenant-a') {
  return (req: any, _res: any, next: any) => {
    req.user = { id: 'admin-1', tenantId, role };
    next();
  };
}

function startServer(role: string, tenantId = 'tenant-a') {
  const app = express();
  app.use(express.json());
  app.use(createAdminRouter({ authenticateToken: makeAuth(role, tenantId) as any, supabase: supabase as any, publicBaseUrl: 'https://universo.example.com' }));
  return new Promise<{ server: Server; baseUrl: string }>((resolve) => {
    const s = app.listen(0, () => {
      const address = s.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      resolve({ server: s, baseUrl: `http://127.0.0.1:${port}` });
    });
  });
}

afterEach(async () => {
  if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe('PATCH /api/admin/operators/:id — email/name/password', () => {
  it('troca o e-mail (login) de um operador', async () => {
    supabase = createFakeSupabase({
      operators: [{ id: 'op-1', tenant_id: 'tenant-a', email: 'antigo@x.com', password_hash: 'hash', name: 'Fulano', role: 'operator' }],
    });
    ({ server, baseUrl } = await startServer('admin'));

    const res = await fetch(`${baseUrl}/api/admin/operators/op-1`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'novo@x.com' }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.operator.email).toBe('novo@x.com');
  });

  it('troca a senha e ela vira um hash bcrypt válido (não texto puro)', async () => {
    supabase = createFakeSupabase({
      operators: [{ id: 'op-1', tenant_id: 'tenant-a', email: 'x@x.com', password_hash: 'hash-antigo', name: 'Fulano', role: 'operator' }],
    });
    ({ server, baseUrl } = await startServer('admin'));

    const res = await fetch(`${baseUrl}/api/admin/operators/op-1`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: 'senha-nova-123' }),
    });
    expect(res.status).toBe(200);
    const savedRow = (supabase as any).__tables.operators.find((o: any) => o.id === 'op-1');
    expect(savedRow.password_hash).not.toBe('senha-nova-123');
    expect(savedRow.password_hash).not.toBe('hash-antigo');
    expect(await bcrypt.compare('senha-nova-123', savedRow.password_hash)).toBe(true);
  });

  it('rejeita senha curta demais', async () => {
    supabase = createFakeSupabase({
      operators: [{ id: 'op-1', tenant_id: 'tenant-a', email: 'x@x.com', password_hash: 'hash', name: 'Fulano', role: 'operator' }],
    });
    ({ server, baseUrl } = await startServer('admin'));

    const res = await fetch(`${baseUrl}/api/admin/operators/op-1`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: '123' }),
    });
    expect(res.status).toBe(400);
  });

  it('admin comum não consegue editar operador de outro tenant', async () => {
    supabase = createFakeSupabase({
      operators: [{ id: 'op-1', tenant_id: 'tenant-b', email: 'x@x.com', password_hash: 'hash', name: 'Fulano', role: 'operator' }],
    });
    ({ server, baseUrl } = await startServer('admin', 'tenant-a'));

    const res = await fetch(`${baseUrl}/api/admin/operators/op-1`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'hackeado@x.com' }),
    });
    expect(res.status).toBe(404);
  });
});
