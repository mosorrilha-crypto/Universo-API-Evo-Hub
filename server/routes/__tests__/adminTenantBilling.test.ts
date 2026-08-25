/**
 * TASK-0070 — histórico de pagamento mensal do tenant ao Universo
 * (tenant_billing_records). Registro manual (sem gateway), mesma decisão
 * de escopo já tomada em financial_transactions/Epic 4.4 — um saas_admin
 * marca cada mês como pendente/pago/atrasado.
 */
import express from 'express';
import type { Server } from 'http';
import { afterEach, describe, expect, it } from 'vitest';
import { createAdminRouter } from '../admin';
import { createFakeSupabase } from '../../services/__tests__/fakeSupabase';

let server: Server;
let baseUrl: string;
let supabase: ReturnType<typeof createFakeSupabase>;

function makeAuth(role: string) {
  return (req: any, _res: any, next: any) => {
    req.user = { id: 'saas-1', tenantId: 'tenant-a', role };
    next();
  };
}

function startServer(role: string) {
  const app = express();
  app.use(express.json());
  app.use(createAdminRouter({ authenticateToken: makeAuth(role) as any, supabase: supabase as any, publicBaseUrl: 'https://universo.example.com' }));
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

describe('POST /api/admin/tenants/:id/billing', () => {
  it('cria um registro de cobrança normalizando o mês pro dia 1', async () => {
    supabase = createFakeSupabase({ tenants: [{ id: 'tenant-a', name: 'Tenant A' }] });
    ({ server, baseUrl } = await startServer('saas_admin'));

    const res = await fetch(`${baseUrl}/api/admin/tenants/tenant-a/billing`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ referenceMonth: '2026-08', amount: 500, currency: 'BRL' }),
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.record.reference_month).toBe('2026-08-01');
    expect(body.record.status).toBe('pendente');
    expect(body.record.paid_at).toBeNull();
  });

  it('registra paid_at automaticamente quando criado já como pago', async () => {
    supabase = createFakeSupabase({ tenants: [{ id: 'tenant-a', name: 'Tenant A' }] });
    ({ server, baseUrl } = await startServer('saas_admin'));

    const res = await fetch(`${baseUrl}/api/admin/tenants/tenant-a/billing`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ referenceMonth: '2026-07', amount: 500, status: 'pago' }),
    });
    const body = await res.json();
    expect(body.record.paid_at).toBeTruthy();
  });

  it('rejeita quem não é saas_admin', async () => {
    supabase = createFakeSupabase({ tenants: [{ id: 'tenant-a', name: 'Tenant A' }] });
    ({ server, baseUrl } = await startServer('admin'));

    const res = await fetch(`${baseUrl}/api/admin/tenants/tenant-a/billing`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ referenceMonth: '2026-08', amount: 500 }),
    });
    expect(res.status).toBe(403);
  });
});

describe('GET /api/admin/tenants/:id/billing', () => {
  it('lista só os registros do tenant pedido', async () => {
    supabase = createFakeSupabase({
      tenants: [{ id: 'tenant-a', name: 'Tenant A' }],
      tenant_billing_records: [
        { id: 'r1', tenant_id: 'tenant-a', reference_month: '2026-08-01', amount: 500, status: 'pendente' },
        { id: 'r2', tenant_id: 'tenant-b', reference_month: '2026-08-01', amount: 300, status: 'pendente' },
      ],
    });
    ({ server, baseUrl } = await startServer('saas_admin'));

    const res = await fetch(`${baseUrl}/api/admin/tenants/tenant-a/billing`);
    const body = await res.json();
    expect(body.records).toHaveLength(1);
    expect(body.records[0].id).toBe('r1');
  });
});

describe('PATCH /api/admin/tenants/:id/billing/:recordId', () => {
  it('marca um registro como pago', async () => {
    supabase = createFakeSupabase({
      tenants: [{ id: 'tenant-a', name: 'Tenant A' }],
      tenant_billing_records: [{ id: 'r1', tenant_id: 'tenant-a', reference_month: '2026-08-01', amount: 500, status: 'pendente', paid_at: null }],
    });
    ({ server, baseUrl } = await startServer('saas_admin'));

    const res = await fetch(`${baseUrl}/api/admin/tenants/tenant-a/billing/r1`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'pago' }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.record.status).toBe('pago');
    expect(body.record.paid_at).toBeTruthy();
  });

  it('não deixa marcar registro de outro tenant (id na URL não basta)', async () => {
    supabase = createFakeSupabase({
      tenants: [{ id: 'tenant-a', name: 'Tenant A' }],
      tenant_billing_records: [{ id: 'r1', tenant_id: 'tenant-b', reference_month: '2026-08-01', amount: 500, status: 'pendente' }],
    });
    ({ server, baseUrl } = await startServer('saas_admin'));

    const res = await fetch(`${baseUrl}/api/admin/tenants/tenant-a/billing/r1`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'pago' }),
    });
    expect(res.status).toBe(404);
  });
});
