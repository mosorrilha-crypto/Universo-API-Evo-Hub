/**
 * Achado real em produção ("o áudio não fica na conversa"): o operador
 * gravava e enviava um áudio pelo painel, a Meta recebia normalmente, mas
 * nós nunca guardávamos uma cópia — só o texto placeholder "🎤 Áudio
 * enviado" ficava salvo. Depois de recarregar a página (ou no próximo
 * polling), o áudio real sumia pra sempre, sem nenhuma forma de tocar de
 * novo. Trava que POST /send-media agora salva a mídia real via
 * mediaImageStore, sob o mesmo message_id gravado na conversa.
 */
import express from 'express';
import type { Server } from 'http';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { initDb } from '../../services/db';
import { createFakeSupabase } from '../../services/__tests__/fakeSupabase';

const uploadWhatsAppMedia = vi.fn(async () => 'media-id-123');
const sendWhatsAppMediaMessage = vi.fn(async () => undefined);
const saveMediaImage = vi.fn(async (_supabaseUrl?: string, _supabaseKey?: string, _messageId?: string, _base64?: string, _mimeType?: string) => undefined);

vi.mock('../../services/metaSend', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../services/metaSend')>();
  return { ...actual, uploadWhatsAppMedia, sendWhatsAppMediaMessage };
});
vi.mock('../../services/mediaImageStore', () => ({ getMediaImage: vi.fn(), saveMediaImage }));

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

describe('POST /api/conversations/:phone/send-media — persiste a mídia real (áudio/imagem)', () => {
  it('salva o áudio real via mediaImageStore sob o mesmo message_id gravado na conversa', async () => {
    const res = await fetch(`${baseUrl}/api/conversations/595981111111/send-media`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ base64: 'QUJD', mimeType: 'audio/mp4', filename: 'audio.mp4' }),
    });
    expect(res.status).toBe(200);

    expect(saveMediaImage).toHaveBeenCalledTimes(1);
    const [, , savedMessageId, savedBase64, savedMimeType] = saveMediaImage.mock.calls[0];
    expect(savedBase64).toBe('QUJD');
    expect(savedMimeType).toBe('audio/mp4');

    // O id usado pra salvar a mídia precisa ser o MESMO id da mensagem
    // gravada na conversa (tabela crua — fakeSupabase não emula o embedded
    // select `messages(...)` que a query real do Supabase resolve) — senão
    // GET /api/media/:messageId nunca encontra o áudio de volta ao
    // renderizar o painel.
    const savedMessage = supabase.__tables.messages.find((m: any) => m.type === 'audio');
    expect(savedMessage).toBeTruthy();
    expect(savedMessage.id).toBe(savedMessageId);
  });

  it('continua rejeitando audio/webm antes de chamar a Meta ou salvar qualquer coisa', async () => {
    const res = await fetch(`${baseUrl}/api/conversations/595981111111/send-media`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ base64: 'QUJD', mimeType: 'audio/webm', filename: 'audio.webm' }),
    });
    expect(res.status).toBe(400);
    expect(uploadWhatsAppMedia).not.toHaveBeenCalled();
    expect(saveMediaImage).not.toHaveBeenCalled();
  });
});
