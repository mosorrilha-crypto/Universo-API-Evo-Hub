/**
 * GET /api/admin/tenants/:id/knowledge-base — cópia da Base de Conhecimento
 * real de um tenant como ponto de partida pra configurar outro (18/08/2026,
 * pedido real: os "Modelos de Negócio Prontos" do painel são fixos em
 * código, sem jeito de editar sem deploy). Só saas_admin; remove referências
 * de Storage (vídeo/arquivo de 1º contato, exampleVideoId de produto) porque
 * esses arquivos vivem sob o prefixo do tenant de ORIGEM — copiar a
 * referência crua faria o tenant novo tentar mandar um arquivo que não
 * existe no storage dele.
 */
import express from 'express';
import type { Server } from 'http';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createAdminRouter } from '../admin';
import { createFakeSupabase } from '../../services/__tests__/fakeSupabase';
import { initDb } from '../../services/db';

const SOURCE_TENANT_ID = 'tenant-origem';
const OTHER_TENANT_ID = 'tenant-sem-kb';

let server: Server;
let baseUrl: string;
let supabase: ReturnType<typeof createFakeSupabase>;

function makeAuth(role: string) {
  return (req: any, _res: any, next: any) => {
    req.user = { id: 'op-1', tenantId: SOURCE_TENANT_ID, role };
    next();
  };
}

function startServer(role: string) {
  const app = express();
  app.use(express.json());
  app.use(
    createAdminRouter({
      authenticateToken: makeAuth(role) as any,
      supabase: supabase as any,
      publicBaseUrl: 'https://universo.example.com',
    })
  );
  return new Promise<{ server: Server; baseUrl: string }>((resolve) => {
    const s = app.listen(0, () => {
      const address = s.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      resolve({ server: s, baseUrl: `http://127.0.0.1:${port}` });
    });
  });
}

function completePublishedDocuments(tenantId: string) {
  const documentTypes = [
    'business_profile', 'brand_voice', 'service_catalog', 'pricing_policies',
    'opening_hours', 'faq', 'human_handoff_rules', 'media_assets',
  ];
  return documentTypes.map((documentType) => ({
    id: `${tenantId}-${documentType}`,
    tenant_id: tenantId,
    document_type: documentType,
    version: 2,
    status: 'published',
    data: documentType === 'business_profile'
      ? { companyName: 'Empresa Publicada' }
      : documentType === 'service_catalog'
        ? { products: [{ name: 'Serviço Publicado', price: 'Gs 200.000', exampleVideoId: 'video-storage-origem' }] }
        : documentType === 'pricing_policies'
          ? { businessRules: ['Regra publicada'] }
          : documentType === 'media_assets'
            ? { firstContactBlocks: [{ id: 'texto', type: 'text', text: 'Olá publicado!' }, { id: 'video', type: 'video', videoId: 'video-storage-origem' }] }
            : {},
    created_at: '2026-08-27T00:00:00.000Z',
    updated_at: '2026-08-27T00:00:00.000Z',
    published_at: '2026-08-27T00:00:00.000Z',
  }));
}

beforeEach(() => {
  supabase = createFakeSupabase({
    tenants: [
      { id: SOURCE_TENANT_ID, slug: 'origem', name: 'Empresa Origem' },
      { id: OTHER_TENANT_ID, slug: 'sem-kb', name: 'Empresa Sem KB' },
    ],
    knowledge_base: [
      {
        tenant_id: SOURCE_TENANT_ID,
        data: {
          companyName: 'Empresa Origem',
          products: [{ id: 'p1', name: 'Serviço X', price: 'Gs 100.000', description: 'desc', exampleImageBase64: 'data:image/jpeg;base64,QQ==', exampleVideoId: 'video-storage-origem' }],
          businessRules: ['Regra 1'],
          firstContactBlocks: [
            { id: 'b1', type: 'text', text: 'Olá!' },
            { id: 'b2', type: 'image', imageBase64: 'data:image/jpeg;base64,QQ==' },
            { id: 'b3', type: 'video', videoId: 'video-storage-origem' },
            { id: 'b4', type: 'file', fileId: 'file-storage-origem' },
          ],
        },
      },
    ],
  });
  initDb(supabase as any);
});

afterEach(async () => {
  if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe('GET /api/admin/tenants/:id/knowledge-base', () => {
  it('devolve a base do tenant de origem sem as referências de Storage (vídeo/arquivo de 1º contato, exampleVideoId de produto)', async () => {
    ({ server, baseUrl } = await startServer('saas_admin'));

    const res = await fetch(`${baseUrl}/api/admin/tenants/${SOURCE_TENANT_ID}/knowledge-base`);
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.knowledgeBase.companyName).toBe('Empresa Origem');
    expect(body.knowledgeBase.businessRules).toEqual(['Regra 1']);
    expect(body.knowledgeBase.products[0].exampleVideoId).toBeUndefined();
    expect(body.knowledgeBase.products[0].exampleImageBase64).toBe('data:image/jpeg;base64,QQ=='); // inline, sem risco de Storage — mantém
    expect(body.knowledgeBase.firstContactBlocks).toHaveLength(2); // só text e image sobrevivem
    expect(body.knowledgeBase.firstContactBlocks.map((b: any) => b.type)).toEqual(['text', 'image']);
  });

  it('404 quando o tenant nunca teve Base de Conhecimento salva', async () => {
    ({ server, baseUrl } = await startServer('saas_admin'));
    const res = await fetch(`${baseUrl}/api/admin/tenants/${OTHER_TENANT_ID}/knowledge-base`);
    expect(res.status).toBe(404);
  });

  it('copia a publicação tipada vigente, não a versão defasada do blob de rollback', async () => {
    supabase.__tables.knowledge_base_documents = completePublishedDocuments(SOURCE_TENANT_ID);
    ({ server, baseUrl } = await startServer('saas_admin'));

    const res = await fetch(`${baseUrl}/api/admin/tenants/${SOURCE_TENANT_ID}/knowledge-base`);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.knowledgeBase.companyName).toBe('Empresa Publicada');
    expect(body.knowledgeBase.businessRules).toEqual(['Regra publicada']);
    expect(body.knowledgeBase.products).toEqual([expect.objectContaining({ name: 'Serviço Publicado', price: 'Gs 200.000' })]);
    expect(body.knowledgeBase.products[0].exampleVideoId).toBeUndefined();
    expect(body.knowledgeBase.firstContactBlocks).toEqual([{ id: 'texto', type: 'text', text: 'Olá publicado!' }]);
  });

  it('admin comum (não saas_admin) é rejeitado com 403', async () => {
    ({ server, baseUrl } = await startServer('admin'));
    const res = await fetch(`${baseUrl}/api/admin/tenants/${SOURCE_TENANT_ID}/knowledge-base`);
    expect(res.status).toBe(403);
  });
});
