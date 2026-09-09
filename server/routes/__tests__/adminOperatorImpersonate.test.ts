/**
 * TASK-0363 — impersonação: saas_admin "acessa como" um operador específico
 * dentro de um tenant (pedido real: seletor de tenant já existia, mas não
 * havia jeito de agir como um operador quando um tenant tem vários). Cobre
 * POST /api/admin/operators/:id/impersonate — bloqueio de outro saas_admin,
 * bloqueio de operador inativo, troca do cookie de sessão, e registro do
 * evento 'started' em operator_impersonation_events.
 */
import express from 'express';
import jwt from 'jsonwebtoken';
import type { Server } from 'http';
import { afterEach, describe, expect, it } from 'vitest';
import { createAdminRouter } from '../admin';
import { createFakeSupabase } from '../../services/__tests__/fakeSupabase';

const JWT_SECRET = 'test-secret';
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
      jwtSecret: JWT_SECRET,
      isProduction: false,
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

function impersonate(id: string, body: Record<string, unknown> = {}) {
  return fetch(`${baseUrl}/api/admin/operators/${id}/impersonate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function parseCookie(res: Response) {
  const setCookie = res.headers.get('set-cookie') || '';
  const match = setCookie.match(/universo_session=([^;]+)/);
  return match ? jwt.verify(match[1], JWT_SECRET) as any : null;
}

afterEach(async () => {
  if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe('POST /api/admin/operators/:id/impersonate', () => {
  it('saas_admin impersona um operador: cookie novo carrega a identidade do alvo + impersonatedBy, evento started gravado', async () => {
    const supabase = createFakeSupabase({
      operators: [{ id: 'op-alvo', tenant_id: 'tenant-a', email: 'alvo@example.com', name: 'Alvo', role: 'operator', is_active: true }],
    });
    ({ server, baseUrl } = await startServer(supabase, { id: 'op-saas', tenantId: 'tenant-plat', role: 'saas_admin' }));

    const res = await impersonate('op-alvo', { reason: 'reproduzindo bug relatado' });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.operator).toMatchObject({ id: 'op-alvo', tenantId: 'tenant-a', role: 'operator' });

    const payload = parseCookie(res as any);
    expect(payload).toMatchObject({ id: 'op-alvo', tenantId: 'tenant-a', role: 'operator', impersonatedBy: 'op-saas' });

    const events = (supabase as any).__tables.operator_impersonation_events;
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      tenant_id: 'tenant-a',
      target_operator_id: 'op-alvo',
      actor_id: 'op-saas',
      event_type: 'started',
      reason: 'reproduzindo bug relatado',
    });
  });

  it('bloqueia impersonar outro saas_admin', async () => {
    const supabase = createFakeSupabase({
      operators: [{ id: 'op-outro-saas', tenant_id: 'tenant-a', email: 'x@example.com', name: 'Outro Saas', role: 'saas_admin', is_active: true }],
    });
    ({ server, baseUrl } = await startServer(supabase, { id: 'op-saas', tenantId: 'tenant-plat', role: 'saas_admin' }));

    const res = await impersonate('op-outro-saas');
    expect(res.status).toBe(403);
    expect((supabase as any).__tables.operator_impersonation_events || []).toHaveLength(0);
  });

  it('bloqueia impersonar um operador desativado', async () => {
    const supabase = createFakeSupabase({
      operators: [{ id: 'op-bloqueado', tenant_id: 'tenant-a', email: 'x@example.com', name: 'Bloqueado', role: 'operator', is_active: false }],
    });
    ({ server, baseUrl } = await startServer(supabase, { id: 'op-saas', tenantId: 'tenant-plat', role: 'saas_admin' }));

    const res = await impersonate('op-bloqueado');
    expect(res.status).toBe(400);
    expect((supabase as any).__tables.operator_impersonation_events || []).toHaveLength(0);
  });

  it('bloqueia impersonar a si mesmo', async () => {
    const supabase = createFakeSupabase({
      operators: [{ id: 'op-saas', tenant_id: 'tenant-plat', email: 'x@example.com', name: 'Eu Mesmo', role: 'saas_admin', is_active: true }],
    });
    ({ server, baseUrl } = await startServer(supabase, { id: 'op-saas', tenantId: 'tenant-plat', role: 'saas_admin' }));

    const res = await impersonate('op-saas');
    expect(res.status).toBe(400);
  });

  it('404 quando o operador alvo não existe', async () => {
    const supabase = createFakeSupabase({ operators: [] });
    ({ server, baseUrl } = await startServer(supabase, { id: 'op-saas', tenantId: 'tenant-plat', role: 'saas_admin' }));

    const res = await impersonate('op-inexistente');
    expect(res.status).toBe(404);
  });

  it('bloqueia um admin comum de tenant (só saas_admin pode impersonar)', async () => {
    const supabase = createFakeSupabase({
      operators: [{ id: 'op-alvo', tenant_id: 'tenant-a', email: 'x@example.com', name: 'Alvo', role: 'operator', is_active: true }],
    });
    ({ server, baseUrl } = await startServer(supabase, { id: 'op-admin', tenantId: 'tenant-a', role: 'admin' }));

    const res = await impersonate('op-alvo');
    expect(res.status).toBe(403);
    expect((supabase as any).__tables.operator_impersonation_events || []).toHaveLength(0);
  });
});
