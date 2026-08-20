/**
 * [CRM] GET/PATCH/DELETE /api/crm/leads — conecta o OperatorCRM aos leads
 * reais. Achado real em produção: o painel de CRM era 100% mock/localStorage,
 * leads reais de conversas do WhatsApp nunca apareciam lá sozinhos.
 */
import express from 'express';
import type { Server } from 'http';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createCrmRouter } from '../crm';
import { initDb } from '../../services/db';
import { createFakeSupabase } from '../../services/__tests__/fakeSupabase';

const TENANT_A = 'tenant-a';
const TENANT_B = 'tenant-b';

let server: Server;
let baseUrl: string;
let supabase: ReturnType<typeof createFakeSupabase>;

function fakeAuthenticateToken(req: any, _res: any, next: any) {
  req.user = { id: 'op-1', tenantId: TENANT_A, role: 'admin' };
  next();
}

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use(createCrmRouter({ authenticateToken: fakeAuthenticateToken as any }));
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
  supabase = createFakeSupabase({
    conversations: [
      // Conversa real sem nenhum estado de CRM ainda registrado.
      { id: 'conv-1', tenant_id: TENANT_A, phone: '595981111111', name: 'Clarice', updated_at: NOW, geo_restriction: null },
      // Conversa real com estado de CRM já registrado (operador já interagiu).
      { id: 'conv-2', tenant_id: TENANT_A, phone: '595982222222', name: 'Resquin', updated_at: NOW, geo_restriction: null },
    ],
    messages: [
      { id: 'msg-1', tenant_id: TENANT_A, conversation_id: 'conv-1', sender: 'lead', type: 'text', text: 'Oi', created_at: NOW, reply_to_message_id: null, forwarded_from_message_id: null, edited_at: null, reactions: null },
    ],
    crm_lead_state: [
      { id: 'crm-1', tenant_id: TENANT_A, phone: '595982222222', name: null, email: null, stage: 'proposta', deal_value: 500000, assigned_operator: 'Ana', notes: [], tasks: [], updated_at: NOW },
      // Lead cadastrado manualmente, ainda sem nenhuma conversa real.
      { id: 'crm-2', tenant_id: TENANT_A, phone: '595983333333', name: 'Cliente Manual', email: 'cliente@exemplo.com', stage: 'novo', deal_value: null, assigned_operator: null, notes: [], tasks: [], updated_at: NOW },
    ],
  });
  initDb(supabase);
});

describe('GET /api/crm/leads', () => {
  it('conversa real sem estado de CRM aparece com estágio "novo" por padrão (sem gravar nada)', async () => {
    const res = await fetch(`${baseUrl}/api/crm/leads`);
    expect(res.status).toBe(200);
    const data = await res.json();
    const lead = data.leads.find((l: any) => l.phone === '595981111111');
    expect(lead).toBeTruthy();
    expect(lead.stage).toBe('novo');
    expect(lead.hasConversation).toBe(true);
    expect(lead.name).toBe('Clarice');
    // Nada foi gravado em crm_lead_state só por ter sido listado.
    expect(supabase.__tables.crm_lead_state).toHaveLength(2);
  });

  it('conversa real com estado de CRM já registrado usa o estágio/valor reais, nunca "novo"', async () => {
    const res = await fetch(`${baseUrl}/api/crm/leads`);
    const data = await res.json();
    const lead = data.leads.find((l: any) => l.phone === '595982222222');
    expect(lead.stage).toBe('proposta');
    expect(lead.dealValue).toBe(500000);
    expect(lead.assignedOperator).toBe('Ana');
    expect(lead.name).toBe('Resquin'); // nome da conversa real prevalece
  });

  it('lead cadastrado manualmente sem conversa real aparece com hasConversation:false', async () => {
    const res = await fetch(`${baseUrl}/api/crm/leads`);
    const data = await res.json();
    const lead = data.leads.find((l: any) => l.phone === '595983333333');
    expect(lead).toBeTruthy();
    expect(lead.hasConversation).toBe(false);
    expect(lead.name).toBe('Cliente Manual');
  });
});

describe('PATCH /api/crm/leads/:phone', () => {
  it('cria/atualiza o estado de CRM de verdade', async () => {
    const res = await fetch(`${baseUrl}/api/crm/leads/595981111111`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ stage: 'contato', dealValue: 200000 }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.leadState.stage).toBe('contato');
    expect(data.leadState.dealValue).toBe(200000);

    const listRes = await fetch(`${baseUrl}/api/crm/leads`);
    const listData = await listRes.json();
    const lead = listData.leads.find((l: any) => l.phone === '595981111111');
    expect(lead.stage).toBe('contato');
  });
});

describe('PATCH /api/crm/leads/:phone — ponte com o Financeiro quando o negócio fecha', () => {
  it('marcar um lead como "ganho" com valor negociado gera uma cobrança pendente automaticamente', async () => {
    const res = await fetch(`${baseUrl}/api/crm/leads/595981111111`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ stage: 'ganho', dealValue: 300000 }),
    });
    expect(res.status).toBe(200);

    const rows = (supabase as any).__tables.financial_transactions;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      tenant_id: TENANT_A,
      lead_phone: '595981111111',
      amount: 300000,
      status: 'pendente',
      source_ref: 'crm-won:595981111111',
    });
  });

  it('não gera cobrança quando o lead ainda não tem valor negociado', async () => {
    const res = await fetch(`${baseUrl}/api/crm/leads/595981111111`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ stage: 'ganho' }),
    });
    expect(res.status).toBe(200);
    const rows = (supabase as any).__tables.financial_transactions || [];
    expect(rows).toHaveLength(0);
  });

  it('mover pra qualquer outro estágio nunca gera cobrança automática', async () => {
    const res = await fetch(`${baseUrl}/api/crm/leads/595981111111`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ stage: 'negociacao', dealValue: 300000 }),
    });
    expect(res.status).toBe(200);
    const rows = (supabase as any).__tables.financial_transactions || [];
    expect(rows).toHaveLength(0);
  });
});

describe('DELETE /api/crm/leads/:phone', () => {
  it('remove o estado de CRM (a conversa em si não é afetada)', async () => {
    const res = await fetch(`${baseUrl}/api/crm/leads/595982222222`, { method: 'DELETE' });
    expect(res.status).toBe(200);

    const listRes = await fetch(`${baseUrl}/api/crm/leads`);
    const listData = await listRes.json();
    const lead = listData.leads.find((l: any) => l.phone === '595982222222');
    // Conversa real continua aparecendo, agora com estágio "novo" de novo.
    expect(lead.hasConversation).toBe(true);
    expect(lead.stage).toBe('novo');
  });
});

describe('isolamento entre tenants', () => {
  it('tenant B nunca vê leads/estado de CRM do tenant A', async () => {
    function otherTenantAuth(req: any, _res: any, next: any) {
      req.user = { id: 'op-2', tenantId: TENANT_B, role: 'admin' };
      next();
    }
    const app2 = express();
    app2.use(express.json());
    app2.use(createCrmRouter({ authenticateToken: otherTenantAuth as any }));
    const server2 = await new Promise<Server>((resolve) => {
      const s = app2.listen(0, () => resolve(s));
    });
    const address = server2.address();
    const port = typeof address === 'object' && address ? address.port : 0;

    const res = await fetch(`http://127.0.0.1:${port}/api/crm/leads`);
    const data = await res.json();
    expect(data.leads).toHaveLength(0);
    server2.close();
  });
});
