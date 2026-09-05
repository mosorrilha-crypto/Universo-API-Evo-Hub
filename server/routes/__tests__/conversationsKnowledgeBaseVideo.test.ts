/**
 * Vídeo de exemplo de produto/serviço (pedido real do dono do produto: o
 * agente mandar vídeo, não só foto) — cobre o upload desacoplado de produto
 * (POST /api/knowledge-base/videos, ver comentário em
 * knowledgeBaseVideoStore.ts), o download autenticado, e o envio manual
 * (/send-example-video), mesmo padrão de conversationsSendExamplePhotoPersist.test.ts.
 */
import express from 'express';
import type { Server } from 'http';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { initDb } from '../../services/db';
import { createFakeSupabase } from '../../services/__tests__/fakeSupabase';

const uploadWhatsAppMedia = vi.fn(async () => 'media-id-123');
const sendWhatsAppMediaMessage = vi.fn(async () => undefined);
const uploadKnowledgeBaseVideo = vi.fn(async () => undefined);
const getKnowledgeBaseVideo = vi.fn(async (_url?: string, _key?: string, _tenantId?: string, videoId?: string) =>
  videoId === 'video-existing' ? { buffer: Buffer.from('fake-video-bytes'), contentType: 'video/mp4' } : null
);
const deleteKnowledgeBaseVideo = vi.fn(async () => undefined);
const transcodeToWhatsAppVideo = vi.fn(async (buffer: Buffer, _mimeType: string) => ({ buffer, mimeType: 'video/mp4' }));
const getKnowledgeBase = vi.fn(async () => ({
  products: [
    { name: 'Microlips', price: 'R$ 500', exampleVideoId: 'video-existing', exampleVideoMimeType: 'video/mp4', exampleVideoFileName: 'microlips.mp4' },
    { name: 'Sem Vídeo', price: 'R$ 100' },
  ],
}));
// TASK-0308: a rota passou a ler via getRuntimeKnowledgeBase — delega pra
// getKnowledgeBase() acima, então mockResolvedValueOnce por teste (se
// houver) continua valendo sem precisar duplicar em cada caso.
const getRuntimeKnowledgeBase = vi.fn(async (tenantId: string) => ({ knowledgeBase: await getKnowledgeBase(), source: 'legacy_blob' as const }));

vi.mock('../../services/metaSend', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../services/metaSend')>();
  return { ...actual, uploadWhatsAppMedia, sendWhatsAppMediaMessage };
});
vi.mock('../../services/knowledgeBaseVideoStore', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../services/knowledgeBaseVideoStore')>();
  return { ...actual, uploadKnowledgeBaseVideo, getKnowledgeBaseVideo, deleteKnowledgeBaseVideo };
});
vi.mock('../../services/videoTranscode', () => ({ transcodeToWhatsAppVideo }));
vi.mock('../../services/knowledgeBaseStore', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../services/knowledgeBaseStore')>();
  return { ...actual, getKnowledgeBase, getRuntimeKnowledgeBase, setKnowledgeBase: vi.fn() };
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
  app.use(express.json({ limit: '55mb' })); // maior teste sobe ~36MB brutos; base64 infla ~33% (~48MB) + margem
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
  uploadWhatsAppMedia.mockClear();
  sendWhatsAppMediaMessage.mockClear();
  uploadKnowledgeBaseVideo.mockClear();
  deleteKnowledgeBaseVideo.mockClear();
  transcodeToWhatsAppVideo.mockClear();
  transcodeToWhatsAppVideo.mockImplementation(async (buffer: Buffer) => ({ buffer, mimeType: 'video/mp4' }));
  initDb(createFakeSupabase({
    conversations: [{ id: 'conv-1', tenant_id: TENANT_A, phone: '595981111111', name: 'Cliente A', updated_at: new Date().toISOString(), geo_restriction: null }],
  }));
});

describe('POST /api/knowledge-base/videos', () => {
  it('sobe o vídeo e devolve a referência (videoId/mimeType/fileName/sizeBytes)', async () => {
    const res = await fetch(`${baseUrl}/api/knowledge-base/videos`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fileName: 'video.mp4', mimeType: 'video/mp4', base64: Buffer.from('conteudo-fake').toString('base64') }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.videoId).toMatch(/^video-/);
    expect(body.mimeType).toBe('video/mp4');
    expect(body.fileName).toBe('video.mp4');
    expect(body.sizeBytes).toBeGreaterThan(0);
    expect(uploadKnowledgeBaseVideo).toHaveBeenCalledTimes(1);
    expect(deleteKnowledgeBaseVideo).not.toHaveBeenCalled();
  });

  it('issue #261 — NUNCA apaga o vídeo antigo aqui, mesmo passando oldVideoId (evitaria referência órfã se o operador não salvar a KB depois)', async () => {
    const res = await fetch(`${baseUrl}/api/knowledge-base/videos`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fileName: 'video.mp4', mimeType: 'video/mp4', base64: Buffer.from('novo').toString('base64'), oldVideoId: 'video-existing' }),
    });
    expect(res.status).toBe(200);
    expect(deleteKnowledgeBaseVideo).not.toHaveBeenCalled();
  });

  it('converte automaticamente um formato que a Meta não aceita direto (ex: .MOV/video-quicktime) via ffmpeg antes de subir', async () => {
    const res = await fetch(`${baseUrl}/api/knowledge-base/videos`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fileName: 'video.mov', mimeType: 'video/quicktime', base64: Buffer.from('conteudo-mov-fake').toString('base64') }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.mimeType).toBe('video/mp4');
    expect(transcodeToWhatsAppVideo).toHaveBeenCalledTimes(1);
    expect(transcodeToWhatsAppVideo).toHaveBeenCalledWith(expect.any(Buffer), 'video/quicktime');
    expect(uploadKnowledgeBaseVideo).toHaveBeenCalledWith('https://fake.supabase.co', 'fake-key', TENANT_A, expect.any(String), expect.any(Buffer), 'video/mp4');
  });

  it('rejeita quando a conversão do formato não suportado falha', async () => {
    transcodeToWhatsAppVideo.mockRejectedValueOnce(new Error('ffmpeg falhou (código 1): entrada corrompida'));
    const res = await fetch(`${baseUrl}/api/knowledge-base/videos`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fileName: 'video.webm', mimeType: 'video/webm', base64: Buffer.from('x').toString('base64') }),
    });
    expect(res.status).toBe(400);
    expect(uploadKnowledgeBaseVideo).not.toHaveBeenCalled();
  });

  it('rejeita arquivo que não é vídeo (mimeType fora de video/*) sem tentar converter', async () => {
    const res = await fetch(`${baseUrl}/api/knowledge-base/videos`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fileName: 'documento.pdf', mimeType: 'application/pdf', base64: Buffer.from('x').toString('base64') }),
    });
    expect(res.status).toBe(400);
    expect(transcodeToWhatsAppVideo).not.toHaveBeenCalled();
    expect(uploadKnowledgeBaseVideo).not.toHaveBeenCalled();
  });

  it('rejeita vídeo original maior que o teto de entrada (35MB), antes mesmo de tentar converter', async () => {
    const hugeBuffer = Buffer.alloc(36 * 1024 * 1024, 1);
    const res = await fetch(`${baseUrl}/api/knowledge-base/videos`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fileName: 'video.mov', mimeType: 'video/quicktime', base64: hugeBuffer.toString('base64') }),
    });
    expect(res.status).toBe(400);
    expect(transcodeToWhatsAppVideo).not.toHaveBeenCalled();
    expect(uploadKnowledgeBaseVideo).not.toHaveBeenCalled();
  });

  it('rejeita vídeo maior que 16MB (limite real da Meta)', async () => {
    const bigBuffer = Buffer.alloc(17 * 1024 * 1024, 1);
    const res = await fetch(`${baseUrl}/api/knowledge-base/videos`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fileName: 'video.mp4', mimeType: 'video/mp4', base64: bigBuffer.toString('base64') }),
    });
    expect(res.status).toBe(400);
    expect(uploadKnowledgeBaseVideo).not.toHaveBeenCalled();
  });
});

describe('GET /api/knowledge-base/videos/:videoId', () => {
  it('devolve o binário quando o vídeo existe', async () => {
    const res = await fetch(`${baseUrl}/api/knowledge-base/videos/video-existing`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('video/mp4');
  });

  // TASK-0074 (auditoria de egress do Supabase, 25/08/2026) — essa rota não
  // tinha cache nenhum; cada preview no painel baixava o vídeo de novo do
  // Storage. Mesmo padrão já usado em /api/media/:messageId.
  it('manda Cache-Control privado (id estável, não muda sem reupload)', async () => {
    const res = await fetch(`${baseUrl}/api/knowledge-base/videos/video-existing`);
    expect(res.headers.get('cache-control')).toBe('private, max-age=3600');
    expect(res.headers.get('vary')).toBe('Authorization');
  });

  it('404 quando o vídeo não existe', async () => {
    const res = await fetch(`${baseUrl}/api/knowledge-base/videos/video-nao-existe`);
    expect(res.status).toBe(404);
  });
});

describe('POST /api/conversations/:phone/send-example-video', () => {
  it('envia o vídeo real via Meta (upload + mensagem) quando o produto tem vídeo cadastrado', async () => {
    const res = await fetch(`${baseUrl}/api/conversations/595981111111/send-example-video`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ productName: 'Microlips' }),
    });
    expect(res.status).toBe(200);
    expect(uploadWhatsAppMedia).toHaveBeenCalledWith('pn', 'tok', expect.any(Buffer), 'video/mp4', 'microlips.mp4');
    expect(sendWhatsAppMediaMessage).toHaveBeenCalledWith('pn', 'tok', '595981111111', 'media-id-123', 'video/mp4', 'Microlips');
  });

  it('404 quando o produto não tem vídeo de exemplo cadastrado', async () => {
    const res = await fetch(`${baseUrl}/api/conversations/595981111111/send-example-video`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ productName: 'Sem Vídeo' }),
    });
    expect(res.status).toBe(404);
    expect(uploadWhatsAppMedia).not.toHaveBeenCalled();
  });
});
