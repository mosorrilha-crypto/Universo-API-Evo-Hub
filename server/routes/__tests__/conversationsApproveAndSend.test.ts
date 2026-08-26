import express from 'express';
import type { Server } from 'http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createConversationsRouter } from '../conversations';
import { initDb } from '../../services/db';
import { createFakeSupabase } from '../../services/__tests__/fakeSupabase';

const TENANT_ID = 'tenant-a';
const OTHER_TENANT_ID = 'tenant-b';
const PHONE = '595981111111';

let server: Server;
let baseUrl: string;
let supabase: ReturnType<typeof createFakeSupabase>;

function fakeAuthenticateToken(req: any, _res: any, next: any) {
  req.user = { id: 'op-1', tenantId: TENANT_ID, role: 'admin' };
  next();
}

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use(createConversationsRouter({
    authenticateToken: fakeAuthenticateToken as any,
    jwtSecret: 'test-secret',
  }));
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => resolve());
  });
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  baseUrl = `http://127.0.0.1:${port}`;
});

afterAll(() => server.close());

function seed(kind: 'general' | 'payment_proof' = 'general') {
  const now = new Date().toISOString();
  supabase = createFakeSupabase({
    tenant_approved_reply_examples: [],
    escalations: [
      {
        id: 'esc-a',
        tenant_id: TENANT_ID,
        phone: PHONE,
        contact_name: 'Cliente Teste',
        reason: 'Revisor pré-envio bloqueou a resposta automática.',
        last_message: 'Hola, ¿cuánto dura el servicio?',
        blocked_draft: '¿Agendamos tu turno?',
        country: 'Paraguay',
        resolved: false,
        created_at: now,
        operator_reply: null,
        operator_reply_at: null,
        operator_reply_consumed_at: null,
        kind,
      },
      {
        id: 'esc-b',
        tenant_id: OTHER_TENANT_ID,
        phone: '595982222222',
        contact_name: 'Outro Tenant',
        reason: 'Caso de outro tenant',
        last_message: 'Olá',
        country: 'Paraguay',
        resolved: false,
        created_at: now,
        operator_reply: null,
        operator_reply_at: null,
        operator_reply_consumed_at: null,
        kind: 'general',
      },
      {
        id: 'esc-archived',
        tenant_id: TENANT_ID,
        phone: PHONE,
        contact_name: 'Cliente Teste',
        reason: 'Caso antigo arquivado',
        last_message: 'Olá',
        country: 'Paraguay',
        resolved: false,
        status: 'archived',
        deleted_at: now,
        created_at: now,
        operator_reply: null,
        operator_reply_at: null,
        operator_reply_consumed_at: null,
        kind: 'general',
      },
    ],
  });
  initDb(supabase);
}

describe('POST /api/escalations/:id/approve-and-resolve', () => {
  it('grava o exemplo aprovado e resolve o caso', async () => {
    seed();
    const res = await fetch(`${baseUrl}/api/escalations/esc-a/approve-and-resolve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ approvedReply: 'Dura entre 60 e 90 minutos, depende do serviço escolhido.' }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.escalation.status).toBe('resolved');
    expect(data.escalation.resolutionCode).toBe('approved_and_sent');

    expect(supabase.__tables.tenant_approved_reply_examples).toHaveLength(1);
    const example = supabase.__tables.tenant_approved_reply_examples[0];
    expect(example.tenant_id).toBe(TENANT_ID);
    expect(example.escalation_id).toBe('esc-a');
    expect(example.customer_message).toBe('Hola, ¿cuánto dura el servicio?');
    expect(example.approved_reply).toBe('Dura entre 60 e 90 minutos, depende do serviço escolhido.');
  });

  it('recusa quando o escalonamento é de comprovante de pagamento', async () => {
    seed('payment_proof');
    const res = await fetch(`${baseUrl}/api/escalations/esc-a/approve-and-resolve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ approvedReply: 'Confirmado.' }),
    });
    expect(res.status).toBe(400);
    expect(supabase.__tables.tenant_approved_reply_examples).toHaveLength(0);
  });

  it('não permite usar o ID de escalonamento de outro tenant', async () => {
    seed();
    const res = await fetch(`${baseUrl}/api/escalations/esc-b/approve-and-resolve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ approvedReply: 'Texto qualquer.' }),
    });
    expect(res.status).toBe(404);
    expect(supabase.__tables.tenant_approved_reply_examples).toHaveLength(0);
  });

  it('exige o campo approvedReply', async () => {
    seed();
    const res = await fetch(`${baseUrl}/api/escalations/esc-a/approve-and-resolve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });
});

describe('GET /api/escalations com includeArchived', () => {
  it('omite arquivados por padrão e inclui quando pedido', async () => {
    seed();
    const withoutArchived = await fetch(`${baseUrl}/api/escalations`).then((r) => r.json());
    expect(withoutArchived.escalations.find((e: any) => e.id === 'esc-archived')).toBeUndefined();

    const withArchived = await fetch(`${baseUrl}/api/escalations?includeArchived=true`).then((r) => r.json());
    expect(withArchived.escalations.find((e: any) => e.id === 'esc-archived')).toBeDefined();
  });
});

describe('POST /api/escalations/:id/restore', () => {
  it('traz um caso arquivado de volta como pendente', async () => {
    seed();
    const res = await fetch(`${baseUrl}/api/escalations/esc-archived/restore`, { method: 'POST' });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.escalation.status).toBe('open');

    const list = await fetch(`${baseUrl}/api/escalations`).then((r) => r.json());
    expect(list.escalations.find((e: any) => e.id === 'esc-archived')).toBeDefined();
  });

  it('não permite restaurar caso de outro tenant', async () => {
    seed();
    const res = await fetch(`${baseUrl}/api/escalations/esc-b/restore`, { method: 'POST' });
    expect(res.status).toBe(404);
  });
});
