/**
 * TASK-0218 — upload real de imagem da Base de Conhecimento (foto de
 * exemplo de produto/variante, antes/depois, bloco de imagem do 1º
 * contato), migrando do Base64 inline pro Storage. Mesmo padrão de teste de
 * conversationsKnowledgeBaseVideo.test.ts (upload desacoplado + download
 * autenticado), sem a etapa de transcodificação que só vídeo tem.
 */
import express from 'express';
import type { Server } from 'http';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { initDb } from '../../services/db';
import { createFakeSupabase } from '../../services/__tests__/fakeSupabase';

const uploadKnowledgeBaseImage = vi.fn(async () => undefined);
const getKnowledgeBaseImage = vi.fn(async (_url?: string, _key?: string, _tenantId?: string, imageId?: string) =>
  imageId === 'image-existing' ? { buffer: Buffer.from('fake-image-bytes'), contentType: 'image/jpeg' } : null
);
const deleteKnowledgeBaseImage = vi.fn(async () => undefined);

vi.mock('../../services/knowledgeBaseImageStore', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../services/knowledgeBaseImageStore')>();
  return { ...actual, uploadKnowledgeBaseImage, getKnowledgeBaseImage, deleteKnowledgeBaseImage };
});

const { createConversationsRouter } = await import('../conversations');

const TENANT_A = 'tenant-a';

let server: Server;
let baseUrl: string;

function fakeAuthenticateToken(req: any, _res: any, next: any) {
  req.user = { id: 'op-1', tenantId: TENANT_A, role: 'admin' };
  next();
}

beforeAll(async () => {
  const app = express();
  app.use(express.json({ limit: '10mb' }));
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
  uploadKnowledgeBaseImage.mockClear();
  deleteKnowledgeBaseImage.mockClear();
  initDb(createFakeSupabase({}));
});

describe('POST /api/knowledge-base/images', () => {
  it('sobe a imagem e devolve a referência (imageId/mimeType/fileName/sizeBytes)', async () => {
    const res = await fetch(`${baseUrl}/api/knowledge-base/images`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fileName: 'foto.jpg', mimeType: 'image/jpeg', base64: Buffer.from('conteudo-fake').toString('base64') }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.imageId).toMatch(/^image-/);
    expect(body.mimeType).toBe('image/jpeg');
    expect(body.fileName).toBe('foto.jpg');
    expect(body.sizeBytes).toBeGreaterThan(0);
    expect(uploadKnowledgeBaseImage).toHaveBeenCalledTimes(1);
  });

  it('mesmo padrão da Issue #261 (vídeo): NUNCA apaga a imagem antiga aqui — a limpeza de órfão só acontece depois do save real da KB', async () => {
    const res = await fetch(`${baseUrl}/api/knowledge-base/images`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fileName: 'foto.jpg', mimeType: 'image/jpeg', base64: Buffer.from('novo').toString('base64') }),
    });
    expect(res.status).toBe(200);
    expect(deleteKnowledgeBaseImage).not.toHaveBeenCalled();
  });

  it('aceita PNG e WebP, os outros formatos que a Meta aceita direto', async () => {
    for (const mimeType of ['image/png', 'image/webp']) {
      const res = await fetch(`${baseUrl}/api/knowledge-base/images`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fileName: `foto.${mimeType.split('/')[1]}`, mimeType, base64: Buffer.from('x').toString('base64') }),
      });
      expect(res.status).toBe(200);
    }
  });

  it('rejeita formato de imagem não aceito pela Meta (ex: image/gif), sem tentar subir', async () => {
    const res = await fetch(`${baseUrl}/api/knowledge-base/images`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fileName: 'foto.gif', mimeType: 'image/gif', base64: Buffer.from('x').toString('base64') }),
    });
    expect(res.status).toBe(400);
    expect(uploadKnowledgeBaseImage).not.toHaveBeenCalled();
  });

  it('rejeita arquivo que não é imagem (mimeType fora de image/*)', async () => {
    const res = await fetch(`${baseUrl}/api/knowledge-base/images`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fileName: 'documento.pdf', mimeType: 'application/pdf', base64: Buffer.from('x').toString('base64') }),
    });
    expect(res.status).toBe(400);
    expect(uploadKnowledgeBaseImage).not.toHaveBeenCalled();
  });

  it('rejeita imagem maior que 5MB (limite real da Meta pra mensagem de imagem)', async () => {
    const bigBuffer = Buffer.alloc(6 * 1024 * 1024, 1);
    const res = await fetch(`${baseUrl}/api/knowledge-base/images`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fileName: 'foto.jpg', mimeType: 'image/jpeg', base64: bigBuffer.toString('base64') }),
    });
    expect(res.status).toBe(400);
    expect(uploadKnowledgeBaseImage).not.toHaveBeenCalled();
  });

  it('rejeita quando fileName/mimeType/base64 está ausente', async () => {
    const res = await fetch(`${baseUrl}/api/knowledge-base/images`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fileName: 'foto.jpg', mimeType: 'image/jpeg' }),
    });
    expect(res.status).toBe(400);
    expect(uploadKnowledgeBaseImage).not.toHaveBeenCalled();
  });
});

describe('GET /api/knowledge-base/images/:imageId', () => {
  it('devolve o binário quando a imagem existe', async () => {
    const res = await fetch(`${baseUrl}/api/knowledge-base/images/image-existing`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/jpeg');
  });

  it('manda Cache-Control privado (id estável, não muda sem reupload)', async () => {
    const res = await fetch(`${baseUrl}/api/knowledge-base/images/image-existing`);
    expect(res.headers.get('cache-control')).toBe('private, max-age=3600');
    expect(res.headers.get('vary')).toBe('Authorization');
  });

  it('404 quando a imagem não existe', async () => {
    const res = await fetch(`${baseUrl}/api/knowledge-base/images/image-nao-existe`);
    expect(res.status).toBe(404);
  });
});
