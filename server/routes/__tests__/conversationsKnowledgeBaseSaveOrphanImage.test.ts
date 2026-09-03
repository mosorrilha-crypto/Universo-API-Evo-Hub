/**
 * TASK-0218 — mesma proteção da Issue #261 (vídeo), agora pra imagem: trocar
 * a foto de um produto/variante/antes-depois/bloco de 1º contato SEM depois
 * salvar a KB não pode deixar uma referência órfã. A exclusão da imagem
 * antiga do Storage só acontece dentro do save real (POST /api/knowledge-base)
 * — nunca no momento do upload em si (ver conversationsKnowledgeBaseImage.test.ts).
 *
 * beforeAfter tem 2 ids por par (before/after) — caso que vídeo não tem,
 * coberto aqui explicitamente.
 */
import express from 'express';
import type { Server } from 'http';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const deleteKnowledgeBaseImage = vi.fn(async () => undefined);
vi.mock('../../services/knowledgeBaseImageStore', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../services/knowledgeBaseImageStore')>();
  return { ...actual, deleteKnowledgeBaseImage };
});

const { createConversationsRouter } = await import('../conversations');
const { initDb } = await import('../../services/db');
const { createFakeSupabase } = await import('../../services/__tests__/fakeSupabase');
const { getKnowledgeBase } = await import('../../services/knowledgeBaseStore');

const TENANT_A = 'tenant-a';

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
  app.use(
    createConversationsRouter({
      authenticateToken: fakeAuthenticateToken as any,
      metaAccessToken: 'tok',
      jwtSecret: 'test-secret',
      metaPhoneNumberId: 'pn',
      supabaseUrl: 'https://fake.supabase.co',
      supabaseKey: 'fake-key',
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

beforeEach(() => {
  deleteKnowledgeBaseImage.mockClear();
  supabase = createFakeSupabase({
    knowledge_base: [
      {
        tenant_id: TENANT_A,
        data: {
          products: [
            {
              name: 'Microlips',
              price: 'Gs 500.000',
              exampleImageId: 'image-old-microlips',
              beforeAfter: [{ id: 'ba1', beforeImageId: 'image-old-before', afterImageId: 'image-old-after' }],
              variants: [{ code: 'V1', price: 'Gs 400.000', exampleImageId: 'image-old-variant' }],
            },
          ],
          firstContactBlocks: [{ id: 'b1', type: 'image', imageId: 'image-old-first-contact' }],
        },
      },
    ],
  });
  initDb(supabase);
});

async function saveKb(knowledgeBase: unknown) {
  return fetch(`${baseUrl}/api/knowledge-base`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ knowledgeBase }),
  });
}

describe('POST /api/knowledge-base — limpa imagem órfã só depois do save real', () => {
  it('produto com exampleImageId trocado: apaga só a imagem antiga do Storage', async () => {
    const res = await saveKb({
      products: [{ name: 'Microlips', price: 'Gs 500.000', exampleImageId: 'image-new-microlips', beforeAfter: [{ id: 'ba1', beforeImageId: 'image-old-before', afterImageId: 'image-old-after' }], variants: [{ code: 'V1', price: 'Gs 400.000', exampleImageId: 'image-old-variant' }] }],
      firstContactBlocks: [{ id: 'b1', type: 'image', imageId: 'image-old-first-contact' }],
    });
    expect(res.status).toBe(200);
    expect(deleteKnowledgeBaseImage).toHaveBeenCalledTimes(1);
    expect(deleteKnowledgeBaseImage).toHaveBeenCalledWith('https://fake.supabase.co', 'fake-key', TENANT_A, 'image-old-microlips');
  });

  it('antes/depois removido do produto: apaga AS DUAS imagens do par (before e after)', async () => {
    const res = await saveKb({
      products: [{ name: 'Microlips', price: 'Gs 500.000', exampleImageId: 'image-old-microlips', beforeAfter: [], variants: [{ code: 'V1', price: 'Gs 400.000', exampleImageId: 'image-old-variant' }] }],
      firstContactBlocks: [{ id: 'b1', type: 'image', imageId: 'image-old-first-contact' }],
    });
    expect(res.status).toBe(200);
    expect(deleteKnowledgeBaseImage).toHaveBeenCalledTimes(2);
    const deletedIds = deleteKnowledgeBaseImage.mock.calls.map((call) => (call as any[])[3]).sort();
    expect(deletedIds).toEqual(['image-old-after', 'image-old-before']);
  });

  it('foto de variante trocada: apaga só a imagem antiga da variante', async () => {
    const res = await saveKb({
      products: [{ name: 'Microlips', price: 'Gs 500.000', exampleImageId: 'image-old-microlips', beforeAfter: [{ id: 'ba1', beforeImageId: 'image-old-before', afterImageId: 'image-old-after' }], variants: [{ code: 'V1', price: 'Gs 400.000', exampleImageId: 'image-new-variant' }] }],
      firstContactBlocks: [{ id: 'b1', type: 'image', imageId: 'image-old-first-contact' }],
    });
    expect(res.status).toBe(200);
    expect(deleteKnowledgeBaseImage).toHaveBeenCalledTimes(1);
    expect(deleteKnowledgeBaseImage).toHaveBeenCalledWith('https://fake.supabase.co', 'fake-key', TENANT_A, 'image-old-variant');
  });

  it('bloco de 1º contato removido da sequência: apaga a imagem desse bloco', async () => {
    const res = await saveKb({
      products: [{ name: 'Microlips', price: 'Gs 500.000', exampleImageId: 'image-old-microlips', beforeAfter: [{ id: 'ba1', beforeImageId: 'image-old-before', afterImageId: 'image-old-after' }], variants: [{ code: 'V1', price: 'Gs 400.000', exampleImageId: 'image-old-variant' }] }],
      firstContactBlocks: [],
    });
    expect(res.status).toBe(200);
    expect(deleteKnowledgeBaseImage).toHaveBeenCalledTimes(1);
    expect(deleteKnowledgeBaseImage).toHaveBeenCalledWith('https://fake.supabase.co', 'fake-key', TENANT_A, 'image-old-first-contact');
  });

  it('salvando sem mudar nenhuma referência de imagem: não apaga nada', async () => {
    const res = await saveKb({
      products: [{ name: 'Microlips', price: 'Gs 500.000', exampleImageId: 'image-old-microlips', beforeAfter: [{ id: 'ba1', beforeImageId: 'image-old-before', afterImageId: 'image-old-after' }], variants: [{ code: 'V1', price: 'Gs 400.000', exampleImageId: 'image-old-variant' }] }],
      firstContactBlocks: [{ id: 'b1', type: 'image', imageId: 'image-old-first-contact' }],
    });
    expect(res.status).toBe(200);
    expect(deleteKnowledgeBaseImage).not.toHaveBeenCalled();
  });

  it('a nova referência de imagem é persistida de verdade (não só a limpeza roda)', async () => {
    await saveKb({
      products: [{ name: 'Microlips', price: 'Gs 500.000', exampleImageId: 'image-new-microlips' }],
      firstContactBlocks: [],
    });
    const saved = await getKnowledgeBase(TENANT_A);
    expect(saved?.products?.[0].exampleImageId).toBe('image-new-microlips');
  });
});
