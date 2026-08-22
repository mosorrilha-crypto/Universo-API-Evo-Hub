/**
 * [Financeiro] GET/POST/PATCH/DELETE /api/financial/transactions — conecta o
 * FinancialDashboard aos registros reais. Achado real: o painel era 100%
 * mock/localStorage, cobrança gerada nunca sobrevivia a um cache limpo nem
 * aparecia pra outro operador do mesmo tenant.
 */
import express from 'express';
import type { Server } from 'http';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createFinancialRouter } from '../financial';
import { initDb } from '../../services/db';
import { createFakeSupabase } from '../../services/__tests__/fakeSupabase';

const TENANT_A = 'tenant-a';
const TENANT_B = 'tenant-b';

let server: Server;
let baseUrl: string;
let supabase: ReturnType<typeof createFakeSupabase>;
let authenticatedRole: 'operator' | 'manager' | 'admin' | 'saas_admin' = 'admin';

function fakeAuthenticateToken(req: any, _res: any, next: any) {
  req.user = { id: 'op-1', tenantId: TENANT_A, role: authenticatedRole };
  next();
}

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use(createFinancialRouter({ authenticateToken: fakeAuthenticateToken as any }));
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

const NOW = new Date().toISOString();

beforeEach(() => {
  authenticatedRole = 'admin';
  supabase = createFakeSupabase({
    financial_transactions: [
      {
        id: 'tx-1',
        tenant_id: TENANT_A,
        lead_id: 'real-595981111111',
        lead_name: 'Clarice',
        lead_phone: '595981111111',
        product_name: 'Design de Sobrancelhas',
        amount: 150000,
        payment_method: 'PIX',
        status: 'pendente',
        date: NOW,
        operator_name: 'Ana',
        channel: 'WhatsApp',
        pix_qr_code: 'fake-qr',
        payment_link_url: 'https://pay.example.com/fat_tx-1',
      },
    ],
  });
  initDb(supabase);
});

describe('GET /api/financial/transactions', () => {
  it('lista as transações reais do tenant', async () => {
    const res = await fetch(`${baseUrl}/api/financial/transactions`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.transactions).toHaveLength(1);
    expect(data.transactions[0]).toMatchObject({
      id: 'tx-1',
      leadName: 'Clarice',
      amount: 150000,
      paymentMethod: 'PIX',
      status: 'pendente',
    });
  });
});

describe('POST /api/financial/transactions', () => {
  it('cria uma cobrança de verdade', async () => {
    const res = await fetch(`${baseUrl}/api/financial/transactions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: 'tx-2',
        leadId: 'real-595982222222',
        leadName: 'Resquin',
        leadPhone: '595982222222',
        productName: 'Retoque',
        amount: 50000,
        paymentMethod: 'PIX',
        status: 'pendente',
        date: NOW,
        operatorName: 'Ana',
        channel: 'WhatsApp',
      }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.transaction.id).toBe('tx-2');

    const listRes = await fetch(`${baseUrl}/api/financial/transactions`);
    const listData = await listRes.json();
    expect(listData.transactions).toHaveLength(2);
  });

  it('recusa criação por operador, mesmo que a interface esteja oculta', async () => {
    authenticatedRole = 'operator';
    const res = await fetch(`${baseUrl}/api/financial/transactions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: 'tx-blocked',
        leadId: 'real-1',
        leadName: 'Sem permissão',
        leadPhone: '595981111111',
        productName: 'Serviço',
        amount: 100,
        paymentMethod: 'PIX',
      }),
    });

    expect(res.status).toBe(403);
  });

  it('400 quando falta campo obrigatório', async () => {
    const res = await fetch(`${baseUrl}/api/financial/transactions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: 'tx-3' }),
    });
    expect(res.status).toBe(400);
  });

  it('400 quando paymentMethod é inválido', async () => {
    const res = await fetch(`${baseUrl}/api/financial/transactions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: 'tx-4',
        leadId: 'real-1',
        leadName: 'X',
        leadPhone: '1',
        productName: 'Y',
        amount: 100,
        paymentMethod: 'Dinheiro',
        date: NOW,
      }),
    });
    expect(res.status).toBe(400);
  });
});

describe('PATCH /api/financial/transactions/:id', () => {
  it('atualiza o status de verdade', async () => {
    const res = await fetch(`${baseUrl}/api/financial/transactions/tx-1`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'pago' }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.transaction.status).toBe('pago');
  });

  it('404 quando a transação não existe', async () => {
    const res = await fetch(`${baseUrl}/api/financial/transactions/tx-inexistente`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'pago' }),
    });
    expect(res.status).toBe(404);
  });

  it('400 quando status é inválido', async () => {
    const res = await fetch(`${baseUrl}/api/financial/transactions/tx-1`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'inventado' }),
    });
    expect(res.status).toBe(400);
  });
});

describe('DELETE /api/financial/transactions/:id', () => {
  it('remove a transação de verdade', async () => {
    const res = await fetch(`${baseUrl}/api/financial/transactions/tx-1`, { method: 'DELETE' });
    expect(res.status).toBe(200);

    const listRes = await fetch(`${baseUrl}/api/financial/transactions`);
    const listData = await listRes.json();
    expect(listData.transactions).toHaveLength(0);
  });
});

describe('isolamento entre tenants', () => {
  it('tenant B nunca vê transações do tenant A', async () => {
    function otherTenantAuth(req: any, _res: any, next: any) {
      req.user = { id: 'op-2', tenantId: TENANT_B, role: 'admin' };
      next();
    }
    const app2 = express();
    app2.use(express.json());
    app2.use(createFinancialRouter({ authenticateToken: otherTenantAuth as any }));
    const server2 = await new Promise<Server>((resolve) => {
      const s = app2.listen(0, () => resolve(s));
    });
    const address = server2.address();
    const port = typeof address === 'object' && address ? address.port : 0;

    const res = await fetch(`http://127.0.0.1:${port}/api/financial/transactions`);
    const data = await res.json();
    expect(data.transactions).toHaveLength(0);
    server2.close();
  });
});
