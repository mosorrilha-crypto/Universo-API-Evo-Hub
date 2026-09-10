/**
 * TASK-0218 — isolamento multi-tenant das rotas de imagem da Base de
 * Conhecimento (POST/GET /api/knowledge-base/images*). Princípio obrigatório
 * do pedido original: tenantId NUNCA vem de body/query — sempre resolvido do
 * JWT autenticado (tenantOf(req)), e cada mídia tem associação inequívoca de
 * tenant (path kb-image/{tenantId}/{imageId} no Storage real).
 *
 * Usa um "Storage" fake em memória chaveado por (tenantId, imageId) — não só
 * mocka a função, simula o isolamento real por path, pra provar que o
 * tenant B literalmente não consegue alcançar o arquivo do tenant A mesmo
 * sabendo o imageId exato (sem depender de um mock ingênuo que "sempre
 * devolve algo").
 */
import express from 'express';
import type { Server } from 'http';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { initDb } from '../../services/db';
import { createFakeSupabase } from '../../services/__tests__/fakeSupabase';

const fakeStorage = new Map<string, { buffer: Buffer; contentType: string }>();
const storageKey = (tenantId: string, imageId: string) => `${tenantId}::${imageId}`;

const uploadKnowledgeBaseImage = vi.fn(async (_url: string | undefined, _key: string | undefined, tenantId: string, imageId: string, buffer: Buffer, mimeType: string) => {
  fakeStorage.set(storageKey(tenantId, imageId), { buffer, contentType: mimeType });
});
const getKnowledgeBaseImage = vi.fn(async (_url: string | undefined, _key: string | undefined, tenantId: string, imageId: string) => {
  return fakeStorage.get(storageKey(tenantId, imageId)) || null;
});
const deleteKnowledgeBaseImage = vi.fn(async (_url: string | undefined, _key: string | undefined, tenantId: string, imageId: string) => {
  fakeStorage.delete(storageKey(tenantId, imageId));
});

vi.mock('../../services/knowledgeBaseImageStore', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../services/knowledgeBaseImageStore')>();
  return { ...actual, uploadKnowledgeBaseImage, getKnowledgeBaseImage, deleteKnowledgeBaseImage };
});

const { createConversationsRouter } = await import('../conversations');

const TENANT_A = 'tenant-a';
const TENANT_B = 'tenant-b';

let server: Server;
let baseUrl: string;

// Simula 2 sessões JWT diferentes via header de teste — nunca via body/query,
// que é exatamente o que este arquivo garante que a rota real ignora.
function fakeAuthenticateToken(req: any, _res: any, next: any) {
  const tenantId = req.headers['x-test-tenant'] === TENANT_B ? TENANT_B : TENANT_A;
  req.user = { id: 'op-1', tenantId, role: 'admin' };
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
  fakeStorage.clear();
  uploadKnowledgeBaseImage.mockClear();
  getKnowledgeBaseImage.mockClear();
  deleteKnowledgeBaseImage.mockClear();
  initDb(createFakeSupabase({}));
});

async function uploadAs(tenantHeader: string | undefined, body: Record<string, unknown>) {
  return fetch(`${baseUrl}/api/knowledge-base/images`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(tenantHeader ? { 'x-test-tenant': tenantHeader } : {}) },
    body: JSON.stringify(body),
  });
}

async function downloadAs(tenantHeader: string | undefined, imageId: string) {
  return fetch(`${baseUrl}/api/knowledge-base/images/${imageId}`, {
    headers: tenantHeader ? { 'x-test-tenant': tenantHeader } : {},
  });
}

describe('Isolamento multi-tenant — POST/GET /api/knowledge-base/images', () => {
  it('tenant A consegue baixar a própria imagem que acabou de subir', async () => {
    const uploadRes = await uploadAs(TENANT_A, { fileName: 'foto.jpg', mimeType: 'image/jpeg', base64: Buffer.from('foto-do-tenant-a').toString('base64') });
    expect(uploadRes.status).toBe(200);
    const { imageId } = await uploadRes.json();

    const downloadRes = await downloadAs(TENANT_A, imageId);
    expect(downloadRes.status).toBe(200);
    const downloadedBuffer = Buffer.from(await downloadRes.arrayBuffer());
    expect(downloadedBuffer.toString()).toBe('foto-do-tenant-a');
  });

  it('tenant B NUNCA consegue baixar uma imagem do tenant A, mesmo sabendo o imageId exato', async () => {
    const uploadRes = await uploadAs(TENANT_A, { fileName: 'foto.jpg', mimeType: 'image/jpeg', base64: Buffer.from('foto-privada-do-tenant-a').toString('base64') });
    const { imageId } = await uploadRes.json();

    const crossTenantRes = await downloadAs(TENANT_B, imageId);
    expect(crossTenantRes.status).toBe(404);
    expect(getKnowledgeBaseImage).toHaveBeenCalledWith('https://fake.supabase.co', 'fake-key', TENANT_B, imageId);
  });

  it('imagens com o MESMO imageId em tenants diferentes nunca se misturam (paths isolados por tenant)', async () => {
    // Cenário adversarial: se o gerador de id algum dia colidir entre
    // tenants (ou um tenant tentar forçar um id conhecido), o conteúdo de
    // cada tenant ainda precisa ficar isolado por path — nunca por sorte.
    fakeStorage.set(storageKey(TENANT_A, 'colidiu-123'), { buffer: Buffer.from('conteudo-tenant-a'), contentType: 'image/jpeg' });
    fakeStorage.set(storageKey(TENANT_B, 'colidiu-123'), { buffer: Buffer.from('conteudo-tenant-b'), contentType: 'image/jpeg' });

    const resA = await downloadAs(TENANT_A, 'colidiu-123');
    const resB = await downloadAs(TENANT_B, 'colidiu-123');

    expect(Buffer.from(await resA.arrayBuffer()).toString()).toBe('conteudo-tenant-a');
    expect(Buffer.from(await resB.arrayBuffer()).toString()).toBe('conteudo-tenant-b');
  });

  it('um tenantId enviado no corpo do upload é IGNORADO — a imagem sempre é gravada sob o tenant do JWT autenticado', async () => {
    const res = await uploadAs(TENANT_A, {
      fileName: 'foto.jpg',
      mimeType: 'image/jpeg',
      base64: Buffer.from('x').toString('base64'),
      tenantId: TENANT_B, // tentativa de forjar o tenant via body
    });
    expect(res.status).toBe(200);

    expect(uploadKnowledgeBaseImage).toHaveBeenCalledWith('https://fake.supabase.co', 'fake-key', TENANT_A, expect.any(String), expect.any(Buffer), 'image/jpeg');
    // Nunca gravou nada sob o tenant forjado.
    expect(uploadKnowledgeBaseImage).not.toHaveBeenCalledWith(expect.anything(), expect.anything(), TENANT_B, expect.anything(), expect.anything(), expect.anything());
  });

  it('rota de download exige autenticação (sem JWT válido, nunca chega a resolver tenant nenhum)', async () => {
    // authenticateToken real (não o fake deste arquivo) rejeitaria isso antes
    // de chegar na rota — aqui a garantia é que a rota em si sempre passa
    // pelo middleware authenticateToken (não está montada como pública).
    const res = await fetch(`${baseUrl}/api/knowledge-base/images/qualquer-id`);
    // O fake authenticateToken deste arquivo sempre autentica (default tenant-a) —
    // o que este teste garante é que getKnowledgeBaseImage sempre recebeu um
    // tenantId não-vazio, nunca undefined/string vazia por falta de resolução.
    expect(res.status).toBe(404); // imagem não existe pro tenant-a (storage vazio) — mas resolveu tenant, não quebrou
    expect(getKnowledgeBaseImage).toHaveBeenCalledWith(expect.anything(), expect.anything(), TENANT_A, 'qualquer-id');
  });
});
