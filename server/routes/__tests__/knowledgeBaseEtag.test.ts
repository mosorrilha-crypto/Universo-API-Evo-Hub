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
 * TASK-0308: a rota passou a ler via `getRuntimeKnowledgeBase` (fonte
 * tipada/publicada, com fallback pro blob legado quando a publicação
 * estiver incompleta) em vez de um select cru na tabela legada. O ETag
 * deixou de vir de `updated_at` (não existe mais uma única linha/timestamp
 * — a fonte pode ser 8 documentos tipados compostos) e passou a ser um
 * hash do CONTEÚDO devolvido. Este fixture não semeia
 * `knowledge_base_documents`, então toda leitura cai automaticamente no
 * fallback legado e devolve o mesmo `data` que já estava na tabela
 * `knowledge_base` — os testes abaixo continuam válidos sem mudança de
 * fixture, exceto o 3º (ver comentário no teste).
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

beforeAll(async () => {
  supabase = createFakeSupabase({
    tenants: [{ id: TENANT_ID, name: 'Tenant A' }],
    knowledge_base: [{ tenant_id: TENANT_ID, data: { products: [{ id: 'p1', name: 'Produto 1', price: '100', exampleImageBase64: 'data:image/jpeg;base64,AAAA' }] }, updated_at: '2026-08-25T10:00:00.000Z' }],
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

    // ETag agora é hash do CONTEÚDO, não de `updated_at` — só mudar o
    // timestamp (sem mudar `data`) não muda mais o ETag, corretamente
    // (mesmo conteúdo = mesmo hash). Simula um save real de verdade
    // (POST /api/knowledge-base faria isso) adicionando um produto.
    const row = (supabase as any).__tables.knowledge_base.find((r: any) => r.tenant_id === TENANT_ID);
    row.data = { ...row.data, products: [...row.data.products, { id: 'p2', name: 'Produto 2', price: '200' }] };
    row.updated_at = '2026-08-25T11:00:00.000Z';

    const second = await fetch(`${baseUrl}/api/knowledge-base`, { headers: { 'If-None-Match': staleEtag } });
    expect(second.status).toBe(200);
    const secondEtag = second.headers.get('etag');
    expect(secondEtag).not.toBe(staleEtag);
    const body = await second.json();
    expect(body.knowledgeBase.products).toHaveLength(2);
  });
});
