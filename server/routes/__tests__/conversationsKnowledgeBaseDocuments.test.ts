/** TASK-0103 / PR2 — rotas de rascunho/publicação, RBAC e isolamento. */
import express from 'express';
import type { Server } from 'http';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

const { createConversationsRouter } = await import('../conversations');
const { initDb } = await import('../../services/db');
const { createFakeSupabase } = await import('../../services/__tests__/fakeSupabase');

const TENANT_A = 'tenant-a';
const TENANT_B = 'tenant-b';
let server: Server;
let baseUrl: string;
let currentRole = 'admin';
let currentTenant = TENANT_A;
let currentOperator = 'operator-a';
let supabase: ReturnType<typeof createFakeSupabase>;

function fakeAuthenticateToken(req: any, _res: any, next: any) {
  req.user = { id: currentOperator, tenantId: currentTenant, role: currentRole };
  next();
}

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use(createConversationsRouter({
    authenticateToken: fakeAuthenticateToken as any,
    metaAccessToken: 'tok',
    jwtSecret: 'test-secret',
    metaPhoneNumberId: 'pn',
    supabaseUrl: 'https://fake.supabase.co',
    supabaseKey: 'fake-key',
  }));
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => resolve());
  });
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  baseUrl = `http://127.0.0.1:${port}`;
});

afterAll(() => server.close());

beforeEach(() => {
  currentRole = 'admin';
  currentTenant = TENANT_A;
  currentOperator = 'operator-a';
  supabase = createFakeSupabase({
    knowledge_base_documents: [
      { id: 'published-a', tenant_id: TENANT_A, document_type: 'brand_voice', version: 1, status: 'published', data: { toneOfVoice: 'Acolhedor' } },
      { id: 'published-b', tenant_id: TENANT_B, document_type: 'brand_voice', version: 1, status: 'published', data: { toneOfVoice: 'Nunca pode aparecer para A' } },
    ],
    knowledge_base_document_events: [],
  });
  initDb(supabase as any);
});

describe('API administrativa de documentos da Base de Conhecimento', () => {
  it('lista somente a publicação e o rascunho do tenant autenticado', async () => {
    const response = await fetch(`${baseUrl}/api/knowledge-base/documents`);
    expect(response.status).toBe(200);
    const body = await response.json();
    const brandVoice = body.documents.find((document: any) => document.documentType === 'brand_voice');

    expect(body.documents).toHaveLength(8);
    expect(brandVoice).toMatchObject({ published: { id: 'published-a', tenantId: TENANT_A }, draft: null });
    expect(JSON.stringify(body)).not.toContain('Nunca pode aparecer para A');
  });

  it('bloqueia operator e manager em toda a superfície que revela rascunhos ou publica', async () => {
    currentRole = 'operator';
    expect((await fetch(`${baseUrl}/api/knowledge-base/documents`)).status).toBe(403);
    expect((await fetch(`${baseUrl}/api/knowledge-base/documents/brand_voice/draft`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ data: { toneOfVoice: 'Tentativa' } }) })).status).toBe(403);
    currentRole = 'manager';
    expect((await fetch(`${baseUrl}/api/knowledge-base/documents/brand_voice/publish`, { method: 'POST' })).status).toBe(403);
  });

  it('cria e atualiza um rascunho sem substituir a publicação em vigor', async () => {
    const create = await fetch(`${baseUrl}/api/knowledge-base/documents/brand_voice/draft`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ data: { toneOfVoice: 'Objetivo e respeitoso' } }),
    });
    expect(create.status).toBe(200);
    const created = await create.json();
    expect(created.document).toMatchObject({ tenantId: TENANT_A, version: 2, status: 'draft', data: { toneOfVoice: 'Objetivo e respeitoso' } });

    const update = await fetch(`${baseUrl}/api/knowledge-base/documents/brand_voice/draft`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ data: { toneOfVoice: 'Objetivo, respeitoso e em espanhol.' } }),
    });
    expect((await update.json()).document).toMatchObject({ id: created.document.id, version: 2, status: 'draft' });
    expect(supabase.__tables.knowledge_base_documents.find((row: any) => row.id === 'published-a')).toMatchObject({ status: 'published', data: { toneOfVoice: 'Acolhedor' } });
  });

  it('publica apenas o rascunho do tenant, arquiva a versão anterior e registra auditoria', async () => {
    await fetch(`${baseUrl}/api/knowledge-base/documents/brand_voice/draft`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ data: { toneOfVoice: 'Objetivo e respeitoso' } }),
    });
    const publish = await fetch(`${baseUrl}/api/knowledge-base/documents/brand_voice/publish`, { method: 'POST' });

    expect(publish.status).toBe(200);
    expect((await publish.json()).document).toMatchObject({ tenantId: TENANT_A, version: 2, status: 'published' });
    expect(supabase.__tables.knowledge_base_documents.find((row: any) => row.id === 'published-a')).toMatchObject({ status: 'archived' });
    expect(supabase.__tables.knowledge_base_documents.find((row: any) => row.tenant_id === TENANT_B)).toMatchObject({ status: 'published', data: { toneOfVoice: 'Nunca pode aparecer para A' } });

    const events = await fetch(`${baseUrl}/api/knowledge-base/documents/brand_voice/events`);
    expect(events.status).toBe(200);
    expect((await events.json()).events).toEqual(expect.arrayContaining([
      expect.objectContaining({ eventType: 'draft_created', version: 2, actorId: 'operator-a' }),
      expect.objectContaining({ eventType: 'published', version: 2, actorId: 'operator-a' }),
    ]));
  });

  it('rejeita publicação sem rascunho e payloads inválidos sem criar documentos', async () => {
    expect((await fetch(`${baseUrl}/api/knowledge-base/documents/faq/publish`, { method: 'POST' })).status).toBe(409);
    const invalid = await fetch(`${baseUrl}/api/knowledge-base/documents/brand_voice/draft`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ data: { toneOfVoice: 'Ok', tenant_id: TENANT_B } }),
    });
    expect(invalid.status).toBe(400);
    expect(supabase.__tables.knowledge_base_documents.filter((row: any) => row.status === 'draft')).toHaveLength(0);
  });
});
