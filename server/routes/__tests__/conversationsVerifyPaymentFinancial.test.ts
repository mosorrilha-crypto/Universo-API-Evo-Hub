/**
 * Achado real em produção (19/08/2026, pedido direto do dono do produto): o
 * fluxo real de venda (WhatsApp → agendamento → comprovante aprovado) e o
 * Financeiro eram dois sistemas paralelos — confirmar um pagamento só
 * atualizava o agendamento, nunca virava um registro financeiro. Este teste
 * trava a ligação nova: aprovar um comprovante (verify-payment) precisa
 * criar uma financial_transaction de verdade, com o preço resolvido da Base
 * de Conhecimento pelo nome do serviço, sem nunca inventar valor pra
 * serviço fora do catálogo.
 */
import express from 'express';
import type { Server } from 'http';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createConversationsRouter } from '../conversations';
import { initDb } from '../../services/db';
import { createFakeSupabase } from '../../services/__tests__/fakeSupabase';

const TENANT_ID = 'tenant-a';
const OPERATOR_ID = 'op-123';
const PHONE = '595981234567';

let server: Server;
let baseUrl: string;
let supabase: ReturnType<typeof createFakeSupabase>;

function fakeAuthenticateToken(req: any, _res: any, next: any) {
  req.user = { id: OPERATOR_ID, tenantId: TENANT_ID, role: 'admin' };
  next();
}

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use(
    createConversationsRouter({
      authenticateToken: fakeAuthenticateToken as any,
      metaAccessToken: 'tok',
      jwtSecret: 'test-secret',
      metaPhoneNumberId: 'pn',
      isFinancialModuleEnabled: async () => true,
      isAgendaModuleEnabled: async () => true,
    })
  );
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

function seed(products: any[]) {
  supabase = createFakeSupabase({
    appointments: [
      { tenant_id: TENANT_ID, phone: PHONE, event_id: 'evt-1', summary: 'Microlips', start_iso: '2026-08-10T10:00:00', end_iso: '2026-08-10T11:30:00', created_at: new Date().toISOString(), payment_status: 'pending_verification', payment_proof_message_id: 'msg-1', payment_verified_by: null, payment_verified_at: null },
    ],
    knowledge_base: [{ tenant_id: TENANT_ID, data: { products } }],
  });
  initDb(supabase);
}

describe('POST /api/conversations/:phone/verify-payment — cria transação financeira automaticamente', () => {
  beforeEach(() => {
    seed([{ name: 'Microlips', price: 'Gs 500.000', priceAmount: 500000 }]);
  });

  it('cria a transação com o valor real do catálogo quando o serviço bate com um produto', async () => {
    const res = await fetch(`${baseUrl}/api/conversations/${PHONE}/verify-payment`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'verified' }),
    });
    expect(res.status).toBe(200);

    const rows = (supabase as any).__tables.financial_transactions;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      tenant_id: TENANT_ID,
      lead_phone: PHONE,
      product_name: 'Microlips',
      amount: 500000,
      payment_method: 'Transferência Bancária',
      status: 'pago',
      source_ref: 'apt:evt-1',
    });
  });

  it('nunca inventa valor pra serviço que não bate com nenhum produto do catálogo (amount 0)', async () => {
    seed([{ name: 'Outro Serviço Qualquer', price: 'Gs 100.000', priceAmount: 100000 }]);
    const res = await fetch(`${baseUrl}/api/conversations/${PHONE}/verify-payment`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'verified' }),
    });
    expect(res.status).toBe(200);

    const rows = (supabase as any).__tables.financial_transactions;
    expect(rows).toHaveLength(1);
    expect(rows[0].amount).toBe(0);
  });

  it('não cria nenhuma transação quando o pagamento é rejeitado', async () => {
    const res = await fetch(`${baseUrl}/api/conversations/${PHONE}/verify-payment`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'rejected' }),
    });
    expect(res.status).toBe(200);
    const rows = (supabase as any).__tables.financial_transactions || [];
    expect(rows).toHaveLength(0);
  });
});

/**
 * Achado real em produção (01/09/2026): o CRM e este fluxo de pagamento
 * verificado eram dois sistemas paralelos — confirmar uma seña nunca
 * refletia no estágio do lead no CRM. Este bloco trava a ligação nova:
 * seña verificada avança o lead pro estágio 'ganho' do CRM automaticamente.
 */
describe('POST /api/conversations/:phone/verify-payment — avança o lead pro estágio "ganho" no CRM', () => {
  beforeEach(() => {
    seed([{ name: 'Microlips', price: 'Gs 500.000', priceAmount: 500000 }]);
  });

  it('lead sem nenhum estado de CRM prévio: cria a linha já em "ganho"', async () => {
    const res = await fetch(`${baseUrl}/api/conversations/${PHONE}/verify-payment`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'verified' }),
    });
    expect(res.status).toBe(200);

    const crmRows = (supabase as any).__tables.crm_lead_state;
    expect(crmRows).toHaveLength(1);
    expect(crmRows[0]).toMatchObject({ tenant_id: TENANT_ID, phone: PHONE, stage: 'ganho' });
  });

  it('lead já em outro estágio do funil: avança pra "ganho" sem perder os outros dados', async () => {
    supabase.__tables.crm_lead_state = [
      { id: 'crm-1', tenant_id: TENANT_ID, phone: PHONE, name: 'Cliente Teste', email: null, stage: 'contato', deal_value: null, assigned_operator: 'Ana', notes: [], tasks: [], updated_at: new Date().toISOString() },
    ];

    const res = await fetch(`${baseUrl}/api/conversations/${PHONE}/verify-payment`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'verified' }),
    });
    expect(res.status).toBe(200);

    const crmRows = (supabase as any).__tables.crm_lead_state;
    expect(crmRows).toHaveLength(1);
    expect(crmRows[0]).toMatchObject({ phone: PHONE, stage: 'ganho', assigned_operator: 'Ana' });
  });

  it('pagamento rejeitado nunca mexe no estágio do CRM', async () => {
    const res = await fetch(`${baseUrl}/api/conversations/${PHONE}/verify-payment`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'rejected' }),
    });
    expect(res.status).toBe(200);
    const crmRows = (supabase as any).__tables.crm_lead_state || [];
    expect(crmRows).toHaveLength(0);
  });

  it('reentrega do mesmo pagamento (retry, sourceRef duplicado) continua idempotente e mantém o CRM em "ganho"', async () => {
    const first = await fetch(`${baseUrl}/api/conversations/${PHONE}/verify-payment`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'verified' }),
    });
    expect(first.status).toBe(200);

    const second = await fetch(`${baseUrl}/api/conversations/${PHONE}/verify-payment`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'verified' }),
    });
    expect(second.status).toBe(200);

    const financialRows = (supabase as any).__tables.financial_transactions;
    expect(financialRows).toHaveLength(1); // sem duplicar no financeiro

    const crmRows = (supabase as any).__tables.crm_lead_state;
    expect(crmRows).toHaveLength(1);
    expect(crmRows[0].stage).toBe('ganho');
  });
});
