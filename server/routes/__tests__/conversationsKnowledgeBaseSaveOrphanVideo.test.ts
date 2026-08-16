/**
 * Issue #261 — trocar o vídeo de um produto ou de um bloco de "1º contato"
 * SEM depois clicar em "Salvar Regras no Agente" (fechou a aba, caiu a
 * conexão etc.) não podia mais deixar uma referência órfã na KB salva. A
 * correção moveu a exclusão do vídeo antigo do Storage pra dentro do save
 * real (POST /api/knowledge-base): só apaga o que estava referenciado na KB
 * anterior e deixou de estar na nova — nunca no momento do upload em si (ver
 * conversationsKnowledgeBaseVideo.test.ts pro upload em si).
 */
import express from 'express';
import type { Server } from 'http';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const deleteKnowledgeBaseVideo = vi.fn(async () => undefined);
vi.mock('../../services/knowledgeBaseVideoStore', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../services/knowledgeBaseVideoStore')>();
  return { ...actual, deleteKnowledgeBaseVideo };
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
    server = app.listen(0, resolve);
  });
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  baseUrl = `http://127.0.0.1:${port}`;
});

afterAll(() => {
  server.close();
});

beforeEach(() => {
  deleteKnowledgeBaseVideo.mockClear();
  supabase = createFakeSupabase({
    knowledge_base: [
      {
        tenant_id: TENANT_A,
        data: {
          products: [{ name: 'Microlips', price: 'Gs 500.000', exampleVideoId: 'video-old-microlips' }],
          firstContactBlocks: [{ id: 'b1', type: 'video', videoId: 'video-old-first-contact' }],
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

describe('POST /api/knowledge-base — limpa vídeo órfão só depois do save real (issue #261)', () => {
  it('produto com exampleVideoId trocado: apaga só o vídeo antigo do Storage', async () => {
    const res = await saveKb({
      products: [{ name: 'Microlips', price: 'Gs 500.000', exampleVideoId: 'video-new-microlips' }],
      firstContactBlocks: [{ id: 'b1', type: 'video', videoId: 'video-old-first-contact' }],
    });
    expect(res.status).toBe(200);
    expect(deleteKnowledgeBaseVideo).toHaveBeenCalledTimes(1);
    expect(deleteKnowledgeBaseVideo).toHaveBeenCalledWith('https://fake.supabase.co', 'fake-key', TENANT_A, 'video-old-microlips');
  });

  it('bloco de 1º contato removido da sequência: apaga o vídeo desse bloco', async () => {
    const res = await saveKb({
      products: [{ name: 'Microlips', price: 'Gs 500.000', exampleVideoId: 'video-old-microlips' }],
      firstContactBlocks: [],
    });
    expect(res.status).toBe(200);
    expect(deleteKnowledgeBaseVideo).toHaveBeenCalledTimes(1);
    expect(deleteKnowledgeBaseVideo).toHaveBeenCalledWith('https://fake.supabase.co', 'fake-key', TENANT_A, 'video-old-first-contact');
  });

  it('salvando sem mudar nenhuma referência de vídeo: não apaga nada', async () => {
    const res = await saveKb({
      products: [{ name: 'Microlips', price: 'Gs 500.000', exampleVideoId: 'video-old-microlips' }],
      firstContactBlocks: [{ id: 'b1', type: 'video', videoId: 'video-old-first-contact' }],
    });
    expect(res.status).toBe(200);
    expect(deleteKnowledgeBaseVideo).not.toHaveBeenCalled();
  });

  it('adicionando um vídeo novo (sem remover nenhum existente): não apaga nada', async () => {
    const res = await saveKb({
      products: [
        { name: 'Microlips', price: 'Gs 500.000', exampleVideoId: 'video-old-microlips' },
        { name: 'Retoque', price: 'Gs 150.000', exampleVideoId: 'video-new-retoque' },
      ],
      firstContactBlocks: [{ id: 'b1', type: 'video', videoId: 'video-old-first-contact' }],
    });
    expect(res.status).toBe(200);
    expect(deleteKnowledgeBaseVideo).not.toHaveBeenCalled();
  });

  it('a nova referência de vídeo é persistida de verdade (não só a limpeza roda)', async () => {
    await saveKb({
      products: [{ name: 'Microlips', price: 'Gs 500.000', exampleVideoId: 'video-new-microlips' }],
      firstContactBlocks: [],
    });
    const saved = await getKnowledgeBase(TENANT_A);
    expect(saved?.products?.[0].exampleVideoId).toBe('video-new-microlips');
  });
});
