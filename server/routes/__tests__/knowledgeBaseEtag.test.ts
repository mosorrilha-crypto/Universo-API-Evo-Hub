/**
 * GET /api/knowledge-base — cache condicional por ETag (pedido direto de
 * chat, 25/08/2026: incidente real de cota de saída/egress do Supabase —
 * a Base de Conhecimento de um tenant sozinha chegou a ~12MB, quase tudo
 * foto de exemplo de produto inline em base64, e essa rota mandava o
 * objeto inteiro de novo TODA VEZ que o painel recarregava, mesmo sem
 * nenhum lead real ainda, só de desenvolvimento/teste repetido. Fix é só
 * de transporte — não muda o formato salvo nem o contrato de dados,
 * POST/save continuam idênticos.
 *
 * TASK-0308/TASK-0327: a rota lê via `getRuntimeKnowledgeBase` (fonte
 * tipada/publicada — o blob legado foi eliminado, sem fallback). O ETag
 * deixou de vir de `updated_at` (não existe mais uma única linha/timestamp
 * — a fonte é a composição de 8 documentos tipados) e passou a ser um hash
 * do CONTEÚDO devolvido. Este fixture semeia os 8 documentos publicados,
 * com o catálogo dentro de `service_catalog`.
 */
import express from 'express';
import type { Server } from 'http';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createConversationsRouter } from '../conversations';
import { initDb } from '../../services/db';
import { createFakeSupabase } from '../../services/__tests__/fakeSupabase';

const TENANT_ID = 'tenant-a';
let server: Server;
let baseUrl: string;
let supabase: ReturnType<typeof createFakeSupabase>;

function fakeAuthenticateToken(): any {
  return (req: any, _res: any, next: any) => {
    req.user = { id: 'op-1', tenantId: TENANT_ID, role: 'admin' };
    next();
  };
}

function makeApp() {
  const app = express();
  app.use(express.json({ limit: '10mb' }));
  app.use(
    createConversationsRouter({
      authenticateToken: fakeAuthenticateToken() as any,
      jwtSecret: 'test-secret',
      metaAccessToken: 'shared-meta-token',
      metaPhoneNumberId: 'shared-pn-id',
    })
  );
  return app;
}

const OTHER_DOCUMENT_TYPES = ['business_profile', 'brand_voice', 'pricing_policies', 'opening_hours', 'faq', 'human_handoff_rules', 'media_assets'] as const;

beforeAll(async () => {
  supabase = createFakeSupabase({
    tenants: [{ id: TENANT_ID, name: 'Tenant A' }],
    knowledge_base_documents: [
      { id: `${TENANT_ID}-service_catalog`, tenant_id: TENANT_ID, document_type: 'service_catalog', version: 1, status: 'published', data: { products: [{ id: 'p1', name: 'Produto 1', price: '100', exampleImageBase64: 'data:image/jpeg;base64,AAAA' }] } },
      ...OTHER_DOCUMENT_TYPES.map((documentType) => ({ id: `${TENANT_ID}-${documentType}`, tenant_id: TENANT_ID, document_type: documentType, version: 1, status: 'published', data: {} })),
    ],
  });
  initDb(supabase as any);

  const app = makeApp();
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

afterEach(() => {
  // nada a limpar entre os testes desta suíte — dado fixo/somente leitura
});

describe('GET /api/knowledge-base — ETag', () => {
  it('primeira busca devolve 200 com o corpo inteiro e um ETag', async () => {
    const res = await fetch(`${baseUrl}/api/knowledge-base`);
    expect(res.status).toBe(200);
    const etag = res.headers.get('etag');
    expect(etag).toBeTruthy();
    const body = await res.json();
    expect(body.knowledgeBase.products[0].exampleImageBase64).toBe('data:image/jpeg;base64,AAAA');
  });

  it('segunda busca com If-None-Match igual devolve 304 sem corpo', async () => {
    const first = await fetch(`${baseUrl}/api/knowledge-base`);
    const etag = first.headers.get('etag')!;

    const second = await fetch(`${baseUrl}/api/knowledge-base`, { headers: { 'If-None-Match': etag } });
    expect(second.status).toBe(304);
    const text = await second.text();
    expect(text).toBe('');
  });

  it('If-None-Match desatualizado (dado mudou) devolve 200 com o corpo de novo', async () => {
    const first = await fetch(`${baseUrl}/api/knowledge-base`);
    const staleEtag = first.headers.get('etag')!;

    // ETag é hash do CONTEÚDO — simula uma publicação real de verdade
    // (draft + publish no service_catalog faria isso) adicionando um produto.
    const row = (supabase as any).__tables.knowledge_base_documents.find((r: any) => r.tenant_id === TENANT_ID && r.document_type === 'service_catalog');
    row.data = { ...row.data, products: [...row.data.products, { id: 'p2', name: 'Produto 2', price: '200' }] };

    const second = await fetch(`${baseUrl}/api/knowledge-base`, { headers: { 'If-None-Match': staleEtag } });
    expect(second.status).toBe(200);
    const secondEtag = second.headers.get('etag');
    expect(secondEtag).not.toBe(staleEtag);
    const body = await second.json();
    expect(body.knowledgeBase.products).toHaveLength(2);
  });
});
