import { describe, expect, it, vi, beforeEach } from 'vitest';
import { createWebhooksRouter } from '../webhooks';
import { initDb } from '../../services/db';
import { createFakeSupabase } from '../../services/__tests__/fakeSupabase';
import { downloadEvolutionMedia } from '../../services/mediaDownload';
import { saveMediaImage } from '../../services/mediaImageStore';

vi.mock('../../services/mediaDownload', () => ({
  downloadEvolutionMedia: vi.fn(async () => ({ base64: 'Zm90bw==', mimeType: 'image/jpeg' })),
  downloadMetaMedia: vi.fn(),
  withMediaDownloadRetry: (fn: () => Promise<unknown>) => fn(),
}));
vi.mock('../../services/mediaImageStore', () => ({ saveMediaImage: vi.fn(async () => true) }));

beforeEach(() => { initDb(createFakeSupabase()); vi.clearAllMocks(); });

describe('download de mídia usa a chave do webhook, não o telefone normalizado', () => {
  it.each([
    ['imageMessage', false], ['stickerMessage', false], ['imageMessage', true],
  ] as const)('%s fromMe=%s preserva @lid no pedido de download e salva a mídia', async (kind, fromMe) => {
    const router = createWebhooksRouter({
      metaWebhookVerifyToken: 'verify', evolutionInstanceName: 'test-instance',
      evolutionApiUrl: 'https://evolution.example.test', evolutionApiKey: 'test-key',
    });
    // Exercita o handler real sem abrir porta de rede no ambiente de testes.
    const route = router.stack.find((layer: any) => layer.route?.path === '/api/webhooks/evolution' && layer.route.methods.post);
    const key = { id: `media-${kind}-${fromMe}`, remoteJid: '123456@lid', remoteJidAlt: '556798038466@s.whatsapp.net', fromMe };
    const req = { body: { event: 'messages.upsert', instance: 'test-instance', data: { key, message: { [kind]: {} } } }, headers: {} };
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis() };
    await route!.route.stack[0].handle(req, res, vi.fn());
    await vi.waitFor(() => expect(saveMediaImage).toHaveBeenCalled());
    expect(res.status).toHaveBeenCalledWith(200);
    expect(downloadEvolutionMedia).toHaveBeenCalledWith(key, 'test-instance', 'https://evolution.example.test', 'test-key');
    expect(saveMediaImage).toHaveBeenCalledWith(undefined, undefined, key.id, 'Zm90bw==', 'image/jpeg');
  });
});
