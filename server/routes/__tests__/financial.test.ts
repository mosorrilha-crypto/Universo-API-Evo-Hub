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
let financialModuleEnabled = true;

function fakeAuthenticateToken(req: any, _res: any, next: any) {
  req.user = { id: 'op-1', tenantId: TENANT_A, role: authenticatedRole };
  next();
}

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use(createFinancialRouter({
    authenticateToken: fakeAuthenticateToken as any,
    isFinancialModuleEnabled: async () => financialModuleEnabled,
  }));
  app.use((err: any, _req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (res.headersSent) return next(err);
    res.status(500).json({ error: err?.message || 'Erro interno do servidor.' });
  });
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => resolve());
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
  financialModuleEnabled = true;
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
    recurring_expenses: [
      {
        id: 'rec-1',
        tenant_id: TENANT_A,
        description: 'Aluguel do salão',
        amount: 1500000,
        payment_method: 'Transferência Bancária',
        day_of_month: 5,
        active: true,
        last_generated_month: null,
      },
    ],
  });
  initDb(supabase);
});

describe('GET /api/financial/recurring-expenses', () => {
  it('lista as despesas recorrentes do tenant', async () => {
    const res = await fetch(`${baseUrl}/api/financial/recurring-expenses`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.recurringExpenses).toHaveLength(1);
    expect(data.recurringExpenses[0]).toMatchObject({ id: 'rec-1', description: 'Aluguel do salão', dayOfMonth: 5, active: true });
  });

  it('mantém a auditoria financeira disponível ao SaaS Admin mesmo com o módulo bloqueado para o tenant', async () => {
    authenticatedRole = 'saas_admin';
    financialModuleEnabled = false;
    const res = await fetch(`${baseUrl}/api/financial/recurring-expenses`);
    expect(res.status).toBe(200);
  });
});

describe('POST /api/financial/recurring-expenses', () => {
  it('cadastra uma despesa recorrente de verdade', async () => {
    const res = await fetch(`${baseUrl}/api/financial/recurring-expenses`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ description: 'Assinatura CRM', amount: 200000, paymentMethod: 'PIX', dayOfMonth: 10 }),
    });
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.recurringExpense).toMatchObject({ description: 'Assinatura CRM', amount: 200000, dayOfMonth: 10, active: true });

    const listRes = await fetch(`${baseUrl}/api/financial/recurring-expenses`);
    const listData = await listRes.json();
    expect(listData.recurringExpenses).toHaveLength(2);
  });

  it('400 quando dayOfMonth está fora de 1..28', async () => {
    const res = await fetch(`${baseUrl}/api/financial/recurring-expenses`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ description: 'X', amount: 100, paymentMethod: 'PIX', dayOfMonth: 30 }),
    });
    expect(res.status).toBe(400);
  });

  it('400 quando amount não é maior que zero', async () => {
    const res = await fetch(`${baseUrl}/api/financial/recurring-expenses`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ description: 'X', amount: 0, paymentMethod: 'PIX', dayOfMonth: 5 }),
    });
    expect(res.status).toBe(400);
  });

  it('recusa cadastro por operador', async () => {
    authenticatedRole = 'operator';
    const res = await fetch(`${baseUrl}/api/financial/recurring-expenses`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ description: 'X', amount: 100, paymentMethod: 'PIX', dayOfMonth: 5 }),
    });
    expect(res.status).toBe(403);
  });
});

describe('PATCH /api/financial/recurring-expenses/:id', () => {
  it('pausa uma despesa recorrente', async () => {
    const res = await fetch(`${baseUrl}/api/financial/recurring-expenses/rec-1`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ active: false }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.recurringExpense.active).toBe(false);
  });

  it('404 quando a despesa recorrente não existe', async () => {
    const res = await fetch(`${baseUrl}/api/financial/recurring-expenses/inexistente`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ active: false }),
    });
    expect(res.status).toBe(404);
  });
});

describe('DELETE /api/financial/recurring-expenses/:id', () => {
  it('remove a despesa recorrente de verdade', async () => {
    const res = await fetch(`${baseUrl}/api/financial/recurring-expenses/rec-1`, { method: 'DELETE' });
    expect(res.status).toBe(200);

    const listRes = await fetch(`${baseUrl}/api/financial/recurring-expenses`);
    const listData = await listRes.json();
    expect(listData.recurringExpenses).toHaveLength(0);
  });
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

  it('recusa leitura quando o Admin SaaS desabilitou o módulo para o tenant', async () => {
    financialModuleEnabled = false;
    const res = await fetch(`${baseUrl}/api/financial/transactions`);
    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toMatchObject({ code: 'financial_module_disabled' });
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

  // TASK-0284: idempotência do lançamento criado a partir de um comprovante
  // marcado no chat (sourceRef "chat-image:<messageId>") — reanalisar ou
  // clicar duas vezes na mesma imagem nunca pode duplicar a transação.
  it('aceita e persiste sourceRef', async () => {
    const res = await fetch(`${baseUrl}/api/financial/transactions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: 'tx-comprovante-1',
        leadId: 'chat-image',
        leadName: 'Cliente do WhatsApp',
        leadPhone: '595981111111',
        productName: 'Comprovante recebido no WhatsApp',
        amount: 75000,
        paymentMethod: 'PIX',
        status: 'pago',
        date: NOW,
        entryType: 'income',
        sourceRef: 'chat-image:msg-123',
      }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.transaction.sourceRef).toBe('chat-image:msg-123');
  });

  // Nota: o fake Supabase (fakeSupabase.ts) não simula a constraint única
  // (tenant_id, source_ref) do Postgres real — o caso de duplicidade
  // (isDuplicateSourceRefError → 409) é coberto isoladamente em
  // financialSourceRefConflict.test.ts, mockando createFinancialTransaction
  // diretamente pra simular o erro 23505 real.
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

describe('Contas a Pagar e Receber', () => {
  it('cria um recebível, permite baixa parcial e gera realizado apenas no momento da baixa', async () => {
    const accountRes = await fetch(`${baseUrl}/api/financial/accounts`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Banco principal', accountType: 'bank', openingBalance: 0 }),
    });
    const { account } = await accountRes.json();

    const titleRes = await fetch(`${baseUrl}/api/financial/titles`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ direction: 'receivable', description: 'Pacote de serviços', counterpartyName: 'Clarice', originalAmount: 150, dueDate: '2026-09-10', paymentMethod: 'PIX' }),
    });
    expect(titleRes.status).toBe(201);
    const { title } = await titleRes.json();
    expect(title).toMatchObject({ direction: 'receivable', status: 'open', openAmount: 150 });

    const settlementRes = await fetch(`${baseUrl}/api/financial/titles/${title.id}/settlements`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ amount: 50, financialAccountId: account.id, paymentMethod: 'PIX' }),
    });
    expect(settlementRes.status).toBe(201);
    const settled = await settlementRes.json();
    expect(settled.title).toMatchObject({ status: 'partial', openAmount: 100 });

    const transactionsRes = await fetch(`${baseUrl}/api/financial/transactions`);
    const transactionsData = await transactionsRes.json();
    expect(transactionsData.transactions).toEqual(expect.arrayContaining([expect.objectContaining({ entryType: 'income', status: 'pago', amount: 50, accountId: account.id })]));
  });

  it('recusa baixa acima do valor aberto', async () => {
    const accountRes = await fetch(`${baseUrl}/api/financial/accounts`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Caixa', accountType: 'cash', openingBalance: 0 }),
    });
    const { account } = await accountRes.json();
    const titleRes = await fetch(`${baseUrl}/api/financial/titles`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ direction: 'payable', description: 'Aluguel', counterpartyName: 'Imobiliária', originalAmount: 100, dueDate: '2026-09-05' }),
    });
    const { title } = await titleRes.json();
    const res = await fetch(`${baseUrl}/api/financial/titles/${title.id}/settlements`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ amount: 101, financialAccountId: account.id, paymentMethod: 'PIX' }),
    });
    expect(res.status).toBe(400);
  });
});

describe('estrutura operacional do Financeiro', () => {
  it('cria categoria, conta, item e recebe uma compra com estoque e título a pagar rastreáveis', async () => {
    const categoryRes = await fetch(`${baseUrl}/api/financial/categories`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Insumos', kind: 'cost' }),
    });
    expect(categoryRes.status).toBe(201);

    const accountRes = await fetch(`${baseUrl}/api/financial/accounts`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Caixa principal', accountType: 'cash', openingBalance: 500 }),
    });
    expect(accountRes.status).toBe(201);

    const itemRes = await fetch(`${baseUrl}/api/financial/inventory/items`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Henna', sku: 'HENNA-01', itemType: 'supply', unit: 'un', reorderPoint: 2 }),
    });
    const { item } = await itemRes.json();
    expect(itemRes.status).toBe(201);

    const purchaseRes = await fetch(`${baseUrl}/api/financial/purchases`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ supplierName: 'Fornecedor Beauty', paymentMethod: 'PIX', items: [{ inventoryItemId: item.id, quantity: 4, unitCost: 12 }] }),
    });
    const { purchase } = await purchaseRes.json();
    expect(purchaseRes.status).toBe(201);

    const receiveRes = await fetch(`${baseUrl}/api/financial/purchases/${purchase.id}/receive`, { method: 'POST' });
    expect(receiveRes.status).toBe(200);

    const inventoryRes = await fetch(`${baseUrl}/api/financial/inventory/items`);
    const inventoryData = await inventoryRes.json();
    expect(inventoryData.items).toEqual(expect.arrayContaining([expect.objectContaining({ id: item.id, onHandQuantity: 4, averageUnitCost: 12 })]));

    const titlesRes = await fetch(`${baseUrl}/api/financial/titles`);
    const titlesData = await titlesRes.json();
    expect(titlesData.titles).toEqual(expect.arrayContaining([expect.objectContaining({ direction: 'payable', originalAmount: 48, openAmount: 48, description: 'Compra de estoque — Fornecedor Beauty' })]));
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
    app2.use(createFinancialRouter({ authenticateToken: otherTenantAuth as any, isFinancialModuleEnabled: async () => true }));
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

  it('tenant B nunca vê despesas recorrentes do tenant A', async () => {
    function otherTenantAuth(req: any, _res: any, next: any) {
      req.user = { id: 'op-2', tenantId: TENANT_B, role: 'admin' };
      next();
    }
    const app2 = express();
    app2.use(express.json());
    app2.use(createFinancialRouter({ authenticateToken: otherTenantAuth as any, isFinancialModuleEnabled: async () => true }));
    const server2 = await new Promise<Server>((resolve) => {
      const s = app2.listen(0, () => resolve(s));
    });
    const address = server2.address();
    const port = typeof address === 'object' && address ? address.port : 0;

    const res = await fetch(`http://127.0.0.1:${port}/api/financial/recurring-expenses`);
    const data = await res.json();
    expect(data.recurringExpenses).toHaveLength(0);
    server2.close();
  });
});
