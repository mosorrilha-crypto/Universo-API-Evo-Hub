/**
 * TASK-0243 — achado real de produção (03/09/2026): `processJob` roda no
 * worker assíncrono separado de `processLoop` (fora da cadeia de qualquer
 * requisição HTTP/webhook), então nunca herdava o `TenantDbContext`
 * (AsyncLocalStorage) que `getDb()` (`db.ts`) exige pra liberar acesso sob
 * RLS. Todo áudio recebido de qualquer tenant ficava travado pra sempre no
 * placeholder "🎤 Transcrevendo áudio..." — a chamada real de banco sempre
 * falhava com "Acesso ao banco sem contexto de tenant... recusado pra
 * preservar RLS", capturada silenciosamente pelo catch (só um log de
 * warning). Este teste usa o `tenantDbContext.ts` REAL (não mocka
 * `getTenantDbContext`) pra confirmar que o contexto certo está ativo
 * quando o job acessa a "camada de dados" — os testes anteriores
 * (`transcriptionQueueHistoryCutoff.test.ts`) mockam a camada de dados
 * inteira, por isso nunca pegaram este bug.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getTenantDbContext } from '../tenantDbContext';

const generateAutoReplyForText = vi.fn(async () => null);
vi.mock('../autoReply', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../autoReply')>();
  return { ...actual, generateAutoReplyForText };
});

let capturedContextOnUpdateMessageText: ReturnType<typeof getTenantDbContext> | undefined;
const updateMessageText = vi.fn(async () => {
  capturedContextOnUpdateMessageText = getTenantDbContext();
});
const getConversation = vi.fn(async () => null);
const attachCatalogClickIfMatched = vi.fn(async () => {});
const shouldBlockForAdsOnlyMode = vi.fn(async () => false);
vi.mock('../conversationStore', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../conversationStore')>();
  return { ...actual, getConversation, updateMessageText, attachCatalogClickIfMatched, shouldBlockForAdsOnlyMode, markGeoRestricted: vi.fn(async () => {}), recordOutgoingMessage: vi.fn(async () => {}) };
});

vi.mock('../conversationEvents', () => ({ emitAiReplyStatus: vi.fn() }));
vi.mock('../mediaImageStore', () => ({ saveMediaImage: vi.fn(async () => {}) }));
vi.mock('../geminiTranscription', () => ({
  transcribeAudioWithGemini: vi.fn(async () => ({ source: 'gemini', result: { transcription: 'todo bien' } })),
}));
vi.mock('../mediaDownload', () => ({
  downloadMetaMedia: vi.fn(async () => ({ base64: 'ZmFrZS1hdWRpbw==', mimeType: 'audio/ogg' })),
  downloadEvolutionMedia: vi.fn(async () => ({ base64: 'ZmFrZS1hdWRpbw==', mimeType: 'audio/ogg' })),
}));
vi.mock('../agentStatus', () => ({ isAgentPaused: vi.fn(async () => true) })); // pausado -> não segue pro auto-reply, só precisamos do updateMessageText
vi.mock('../knowledgeBaseStore', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../knowledgeBaseStore')>();
  return { ...actual, getKnowledgeBase: vi.fn(async () => null) };
});
vi.mock('../tenantProfileStore', () => ({ getTenantSegment: vi.fn(async () => 'geral') }));
vi.mock('../escalationStore', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../escalationStore')>();
  return { ...actual, logEscalation: vi.fn(async () => {}) };
});

const { processJob } = await import('../transcriptionQueue');

describe('processJob — contexto de tenant (TASK-0243)', () => {
  beforeEach(() => {
    capturedContextOnUpdateMessageText = undefined;
    updateMessageText.mockClear();
  });

  it('abre o TenantDbContext certo antes de chamar a camada de dados (updateMessageText)', async () => {
    expect(getTenantDbContext()).toBeUndefined(); // fora do job, nenhum contexto ativo

    await processJob(
      {
        message: { provider: 'meta', messageId: 'wamid.audio-ctx', from: '595981234567', contactName: 'Cliente Teste', type: 'audio', metaAudio: { mediaId: 'media-1' } },
        resolvedTenant: { tenantId: 'tenant-ctx', provider: 'meta', metaAccessToken: 'token', metaPhoneNumberId: 'phone-id' },
        createdAt: new Date().toISOString(),
      },
      { getAi: () => ({} as any) },
    );

    expect(updateMessageText).toHaveBeenCalled();
    expect(capturedContextOnUpdateMessageText).toEqual({ tenantId: 'tenant-ctx', source: 'job' });
    expect(getTenantDbContext()).toBeUndefined(); // contexto não vaza pra fora do job
  });
});
