/**
 * TASK-0261 — bloqueio reversível de operador via PATCH /api/admin/operators/:id
 * ({ isActive: false }), separado da exclusão definitiva já existente
 * (DELETE). Mesma checagem de escopo por tenant já usada no DELETE: admin
 * comum só mexe no próprio tenant, saas_admin mexe em qualquer um. Ninguém
 * pode bloquear a própria conta (autobloqueio impediria reverter depois).
 */
import express from 'express';
import type { Server } from 'http';
import { afterEach, describe, expect, it } from 'vitest';
import { createAdminRouter } from '../admin';
import { createFakeSupabase } from '../../services/__tests__/fakeSupabase';

let server: Server;
let baseUrl: string;

function makeAuth(user: { id: string; tenantId: string; role: string }) {
  return (req: any, _res: any, next: any) => {
    req.user = user;
    next();
  };
}

function startServer(supabase: ReturnType<typeof createFakeSupabase>, user: { id: string; tenantId: string; role: string }) {
  const app = express();
  app.use(express.json());
  app.use(
    createAdminRouter({
      authenticateToken: makeAuth(user) as any,
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

function patchOperator(id: string, body: Record<string, unknown>) {
  return fetch(`${baseUrl}/api/admin/operators/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

afterEach(async () => {
  if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe('PATCH /api/admin/operators/:id — bloqueio reversível', () => {
  it('admin bloqueia um operador da própria empresa', async () => {
    const supabase = createFakeSupabase({
      operators: [{ id: 'op-alvo', tenant_id: 'tenant-a', email: 'x@example.com', name: 'Alvo', role: 'operator', is_active: true }],
    });
    ({ server, baseUrl } = await startServer(supabase, { id: 'op-admin', tenantId: 'tenant-a', role: 'admin' }));

    const res = await patchOperator('op-alvo', { isActive: false });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.operator.is_active).toBe(false);
  });

  it('admin de OUTRA empresa não consegue bloquear (404, mesmo isolamento do DELETE)', async () => {
    const supabase = createFakeSupabase({
      operators: [{ id: 'op-alvo', tenant_id: 'tenant-b', email: 'x@example.com', name: 'Alvo', role: 'operator', is_active: true }],
    });
    ({ server, baseUrl } = await startServer(supabase, { id: 'op-admin', tenantId: 'tenant-a', role: 'admin' }));

    const res = await patchOperator('op-alvo', { isActive: false });
    expect(res.status).toBe(404);
  });

  it('saas_admin bloqueia operador de qualquer empresa', async () => {
    const supabase = createFakeSupabase({
      operators: [{ id: 'op-alvo', tenant_id: 'tenant-b', email: 'x@example.com', name: 'Alvo', role: 'operator', is_active: true }],
    });
    ({ server, baseUrl } = await startServer(supabase, { id: 'op-saas', tenantId: 'tenant-a', role: 'saas_admin' }));

    const res = await patchOperator('op-alvo', { isActive: false });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.operator.is_active).toBe(false);
  });

  it('ninguém pode bloquear a própria conta, nem sendo saas_admin', async () => {
    const supabase = createFakeSupabase({
      operators: [{ id: 'op-saas', tenant_id: 'tenant-a', email: 'x@example.com', name: 'Eu Mesmo', role: 'saas_admin', is_active: true }],
    });
    ({ server, baseUrl } = await startServer(supabase, { id: 'op-saas', tenantId: 'tenant-a', role: 'saas_admin' }));

    const res = await patchOperator('op-saas', { isActive: false });
    expect(res.status).toBe(400);
  });

  it('reativar (isActive: true) desfaz o bloqueio', async () => {
    const supabase = createFakeSupabase({
      operators: [{ id: 'op-alvo', tenant_id: 'tenant-a', email: 'x@example.com', name: 'Alvo', role: 'operator', is_active: false }],
    });
    ({ server, baseUrl } = await startServer(supabase, { id: 'op-admin', tenantId: 'tenant-a', role: 'admin' }));

    const res = await patchOperator('op-alvo', { isActive: true });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.operator.is_active).toBe(true);
  });
});
