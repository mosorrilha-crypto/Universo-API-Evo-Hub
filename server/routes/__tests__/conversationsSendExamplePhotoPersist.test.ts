/**
 * Achado ao vivo estendendo o carregamento de imagem real (RealClientImage)
 * pra também cobrir mensagens QUE NÓS enviamos (não só as do lead): a foto
 * de exemplo (Base de Conhecimento) nunca era salva via mediaImageStore —
 * só a mensagem de texto "📷 Foto de exemplo: X" ficava gravada. Sem esse
 * fix, GET /api/media/:messageId nunca encontraria nada pra essa mensagem e
 * o painel mostraria "Imagem indisponível" em vez do preview real. Mesmo
 * padrão já usado em /send-media (ver conversationsSendMediaAudioPersist.test.ts).
 */
import express from 'express';
import type { Server } from 'http';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { initDb } from '../../services/db';
import { createFakeSupabase } from '../../services/__tests__/fakeSupabase';

const uploadWhatsAppMedia = vi.fn(async () => 'media-id-123');
const sendWhatsAppMediaMessage = vi.fn(async () => undefined);
const saveMediaImage = vi.fn(async (_supabaseUrl?: string, _supabaseKey?: string, _messageId?: string, _base64?: string, _mimeType?: string) => undefined);
const getKnowledgeBase = vi.fn(async () => ({
  products: [
    { name: 'Microlips', price: 'R$ 500', exampleImageBase64: 'ZmFrZS1pbWFnZQ==', exampleImageMimeType: 'image/jpeg' },
  ],
}));

vi.mock('../../services/metaSend', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../services/metaSend')>();
  return { ...actual, uploadWhatsAppMedia, sendWhatsAppMediaMessage };
});
vi.mock('../../services/mediaImageStore', () => ({ getMediaImage: vi.fn(), saveMediaImage }));
vi.mock('../../services/knowledgeBaseStore', () => ({ getKnowledgeBase, setKnowledgeBase: vi.fn() }));

const { createConversationsRouter } = await import('../conversations');

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
  uploadWhatsAppMedia.mockClear();
  sendWhatsAppMediaMessage.mockClear();
  saveMediaImage.mockClear();
  supabase = createFakeSupabase({
    conversations: [{ id: 'conv-1', tenant_id: TENANT_A, phone: '595981111111', name: 'Cliente A', updated_at: new Date().toISOString(), geo_restriction: null }],
  });
  initDb(supabase);
});

describe('POST /api/conversations/:phone/send-example-photo — persiste a mídia real', () => {
  it('salva a foto de exemplo via mediaImageStore sob o mesmo message_id gravado na conversa', async () => {
    const res = await fetch(`${baseUrl}/api/conversations/595981111111/send-example-photo`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ productName: 'Microlips' }),
    });
    expect(res.status).toBe(200);

    expect(saveMediaImage).toHaveBeenCalledTimes(1);
    const [, , savedMessageId, savedBase64, savedMimeType] = saveMediaImage.mock.calls[0];
    expect(savedBase64).toBe('ZmFrZS1pbWFnZQ==');
    expect(savedMimeType).toBe('image/jpeg');

    const savedMessage = supabase.__tables.messages.find((m: any) => m.type === 'image');
    expect(savedMessage).toBeTruthy();
    expect(savedMessage.id).toBe(savedMessageId);
  });
});
