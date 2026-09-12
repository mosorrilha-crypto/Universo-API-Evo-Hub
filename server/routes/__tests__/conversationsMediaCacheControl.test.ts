/**
 * TASK-0403 (achado real: imagem de lead confirmada salva no R2 — abria
 * normal no desktop — continuava "Imagem indisponível (HTTP 404)" no
 * celular mesmo minutos depois e mesmo com o auto-retry da TASK-0401
 * rodando). `GET /api/media/:messageId` nunca dizia explicitamente que um
 * 404 não deve ser guardado em cache — sem isso, um proxy transparente de
 * operadora de celular pode reter esse 404 e devolvê-lo de novo pras
 * tentativas seguintes com a MESMA URL, mesmo depois da mídia já estar
 * disponível de verdade no servidor. Cobre que os dois caminhos de 404
 * (mensagem não encontrada nesse tenant; mídia não encontrada no
 * armazenamento) sempre respondem com `Cache-Control: no-store`, e que o
 * caminho de sucesso continua com o cache privado de sempre.
 */
import express from 'express';
import type { Server } from 'http';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { initDb } from '../../services/db';
import { createFakeSupabase } from '../../services/__tests__/fakeSupabase';

const getMediaImage = vi.fn();
vi.mock('../../services/mediaImageStore', () => ({ getMediaImage: (...args: any[]) => getMediaImage(...args), saveMediaImage: vi.fn() }));

const { createConversationsRouter } = await import('../conversations');

const TENANT_A = 'tenant-a';
const MESSAGE_ID = 'real-img-msg-1';

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
      jwtSecret: 'test-secret',
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
  getMediaImage.mockReset();
  supabase = createFakeSupabase({
    messages: [{ id: MESSAGE_ID, tenant_id: TENANT_A, conversation_id: 'conv-1', type: 'image', text: '📷 Imagem recebida', sender: 'lead', created_at: new Date().toISOString() }],
  });
  initDb(supabase);
});

describe('GET /api/media/:messageId — Cache-Control', () => {
  it('404 quando a mídia ainda não foi encontrada no armazenamento: nunca cacheável (no-store)', async () => {
    getMediaImage.mockResolvedValue(null);

    const res = await fetch(`${baseUrl}/api/media/${MESSAGE_ID}`);
    expect(res.status).toBe(404);
    expect(res.headers.get('cache-control')).toBe('no-store');
  });

  it('404 quando a mensagem não existe nesse tenant: nunca cacheável (no-store)', async () => {
    const res = await fetch(`${baseUrl}/api/media/mensagem-que-nao-existe`);
    expect(res.status).toBe(404);
    expect(res.headers.get('cache-control')).toBe('no-store');
    // Nem chega a consultar o armazenamento — falha antes, pela checagem de tenant.
    expect(getMediaImage).not.toHaveBeenCalled();
  });

  it('200 quando a mídia é encontrada: mantém o cache privado de sempre (não usa no-store)', async () => {
    getMediaImage.mockResolvedValue({ buffer: Buffer.from('fake-jpeg-bytes'), contentType: 'image/jpeg' });

    const res = await fetch(`${baseUrl}/api/media/${MESSAGE_ID}`);
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('private, max-age=3600');
    expect(res.headers.get('vary')).toBe('Authorization');
  });
});
