import { beforeEach, describe, expect, it, vi } from 'vitest';
import { initDb } from '../../services/db';
import { createFakeSupabase } from '../../services/__tests__/fakeSupabase';
import { createWebhooksRouter } from '../webhooks';

vi.mock('../../services/mediaDownload', () => ({
  downloadEvolutionMedia: vi.fn(async () => ({ base64: 'Zm90bw==', mimeType: 'image/webp' })),
  downloadMetaMedia: vi.fn(), withMediaDownloadRetry: (fn: () => Promise<unknown>) => fn(),
}));
vi.mock('../../services/transcriptionQueue', () => ({ enqueueTranscriptionJob: vi.fn() }));
vi.mock('../../services/mediaImageStore', () => ({ saveMediaImage: vi.fn(async () => true) }));

let db: ReturnType<typeof createFakeSupabase>;
beforeEach(() => { db = createFakeSupabase(); initDb(db); vi.clearAllMocks(); });

async function receive(kind: string, fromMe: boolean, messageTimestamp?: number) {
  const router = createWebhooksRouter({
    metaWebhookVerifyToken: 'verify', evolutionInstanceName: 'instance-test',
    evolutionApiUrl: 'https://evolution.example.test', evolutionApiKey: 'test-key',
  });
  const route = router.stack.find((layer: any) => layer.route?.path === '/api/webhooks/evolution' && layer.route.methods.post);
  const req = { headers: {}, body: { event: 'messages.upsert', instance: 'instance-test', data: {
    key: { id: `timestamp-${kind}-${fromMe}`, remoteJid: '595981111111@s.whatsapp.net', fromMe },
    messageTimestamp, message: { [kind]: kind === 'conversation' ? 'mensagem antiga' : {} },
  } } } as any;
  const res = { status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis() };
  await route!.route.stack[0].handle(req, res as any, vi.fn());
  expect(res.status).toHaveBeenCalledWith(200);
  return db.__tables.messages[0];
}

describe('data original do webhook até a persistência', () => {
  it.each([
    ['conversation', false], ['imageMessage', false], ['stickerMessage', false], ['audioMessage', false],
    ['conversation', true], ['imageMessage', true], ['documentMessage', false],
  ] as const)('%s fromMe=%s guarda a data antiga, não a data de reprocessamento', async (kind, fromMe) => {
    const original = '2026-11-05T11:55:00.000Z';
    const row = await receive(kind, fromMe, Date.parse(original) / 1000);
    expect(row.created_at).toBe(original);
    expect(row.sender).toBe(fromMe ? 'agent' : 'lead');
  });
  it('sem timestamp do provedor mantém o horário de recebimento como fallback', async () => {
    const before = Date.now();
    const row = await receive('conversation', false);
    expect(Date.parse(row.created_at)).toBeGreaterThanOrEqual(before);
    expect(Date.parse(row.created_at)).toBeLessThanOrEqual(Date.now());
  });
});

describe('ordenação após sincronizar histórico antigo', () => {
  it('mensagem antiga recebida depois não ocupa o lugar da mensagem recente na paginação', async () => {
    const { getConversationMessagesPage } = await import('../../services/conversationStore');
    const recent = '2026-11-10T12:28:00.000Z';
    const old = '2026-11-05T11:55:00.000Z';
    await receive('conversation', false, Date.parse(recent) / 1000);
    await receive('imageMessage', false, Date.parse(old) / 1000);
    const tenantId = db.__tables.messages[0].tenant_id;
    const page = await getConversationMessagesPage(tenantId, '595981111111', { limit: 1 });
    expect(page.messages).toHaveLength(1);
    expect(page.messages[0].timestamp).toBe(recent);
    expect(page.hasMore).toBe(true);
  });
});
