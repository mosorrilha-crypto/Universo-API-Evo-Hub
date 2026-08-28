/**
 * DELETE /api/escalations/:id/permanent (TASK-0132) — pedido do gestor
 * (28/08/2026): escalonamentos de teste do próprio time (ex: número pessoal
 * usado pra testar o agente) contaminavam a fila real, e o DELETE normal
 * (deleteEscalation) só arquiva — o caso continua existindo na aba
 * Arquivados. Essa rota apaga a linha e o histórico de auditoria de vez, e
 * é restrita a saas_admin (via requireRole, middleware/rbac.ts).
 */
import express from 'express';
import type { Server } from 'http';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createConversationsRouter } from '../conversations';
import { initDb, getDb } from '../../services/db';
import { createFakeSupabase } from '../../services/__tests__/fakeSupabase';

const TENANT_ID = 'tenant-a';
const OTHER_TENANT_ID = 'tenant-b';
const PHONE = '595981111111';

let server: Server;
let baseUrl: string;

function fakeAuthenticateToken(req: any, _res: any, next: any) {
  const role = req.header('x-test-role') || 'saas_admin';
  const tenantId = req.header('x-test-tenant') || TENANT_ID;
  req.user = { id: 'op-1', tenantId, role };
  next();
}

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use(
    createConversationsRouter({
      authenticateToken: fakeAuthenticateToken as any,
      jwtSecret: 'test-secret',
      metaAccessToken: 'tok',
      metaPhoneNumberId: 'pn-1',
      getAi: () => ({}) as any,
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

function seed() {
  initDb(createFakeSupabase({
    tenants: [{ id: TENANT_ID, name: 'Studio Bella Vita' }, { id: OTHER_TENANT_ID, name: 'Outro tenant' }],
    escalations: [
      {
        id: 'esc-1',
        tenant_id: TENANT_ID,
        phone: PHONE,
        contact_name: 'Cliente Teste',
        reason: 'Teste interno',
        country: 'Paraguay',
        resolved: false,
        created_at: new Date().toISOString(),
      },
    ],
    escalation_audit_events: [
      { id: 'aud-1', tenant_id: TENANT_ID, escalation_id: 'esc-1', event_type: 'created', detail: {}, created_at: new Date().toISOString() },
    ],
  }));
}

afterEach(() => {
  // nada a limpar entre testes além do reseed em cada `it`
});

describe('DELETE /api/escalations/:id/permanent', () => {
  it('403 pra quem não é saas_admin — não apaga a linha', async () => {
    seed();
    const res = await fetch(`${baseUrl}/api/escalations/esc-1/permanent`, {
      method: 'DELETE',
      headers: { 'x-test-role': 'admin' },
    });
    expect(res.status).toBe(403);
    const { data } = await getDb().from('escalations').select('*').eq('id', 'esc-1');
    expect(data?.length).toBe(1);
  });

  it('saas_admin apaga a linha e o histórico de auditoria de vez (não fica em Arquivados)', async () => {
    seed();
    const res = await fetch(`${baseUrl}/api/escalations/esc-1/permanent`, {
      method: 'DELETE',
      headers: { 'x-test-role': 'saas_admin' },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true });

    const { data: escalationRows } = await getDb().from('escalations').select('*').eq('id', 'esc-1');
    expect(escalationRows?.length).toBe(0);
    const { data: auditRows } = await getDb().from('escalation_audit_events').select('*').eq('escalation_id', 'esc-1');
    expect(auditRows?.length).toBe(0);
  });

  it('404 pra id inexistente', async () => {
    seed();
    const res = await fetch(`${baseUrl}/api/escalations/esc-nao-existe/permanent`, {
      method: 'DELETE',
      headers: { 'x-test-role': 'saas_admin' },
    });
    expect(res.status).toBe(404);
  });

  it('isolamento por tenant: saas_admin logado no tenant errado (sem header de override) não apaga escalonamento de outro tenant', async () => {
    seed();
    const res = await fetch(`${baseUrl}/api/escalations/esc-1/permanent`, {
      method: 'DELETE',
      headers: { 'x-test-role': 'saas_admin', 'x-test-tenant': OTHER_TENANT_ID },
    });
    expect(res.status).toBe(404);
    const { data } = await getDb().from('escalations').select('*').eq('id', 'esc-1');
    expect(data?.length).toBe(1);
  });
});
