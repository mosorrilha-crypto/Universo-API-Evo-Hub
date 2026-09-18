/**
 * TASK-0430 — achado real de audit (tenant Monique, cliente "Carmen
 * Bareiro"): antes desta correção, cada áudio transcrito disparava seu
 * próprio ciclo COMPLETO e independente de resposta automática, sem
 * nenhum agrupamento — uma cliente que manda vários áudios em rajada (comum
 * no WhatsApp) recebia uma resposta por áudio, algumas já desatualizadas
 * pelo tempo de fila, culminando em respostas redundantes em sequência
 * (confirmado nos logs reais: 3 despedidas quase idênticas em ~90s).
 *
 * Este teste reproduz o cenário mínimo: dois áudios da MESMA cliente
 * completam a transcrição em sequência rápida — antes da correção, isso
 * gerava 2 chamadas separadas a generateAutoReplyForText (2 respostas); com
 * o buffer de áudio (audioMessageBuffer.ts), gera 1 chamada só, com as duas
 * transcrições combinadas.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const generateAutoReplyForText = vi.fn(async () => null);
vi.mock('../autoReply', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../autoReply')>();
  return { ...actual, generateAutoReplyForText };
});

const getConversation = vi.fn(async () => null);
vi.mock('../conversationStore', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../conversationStore')>();
  return {
    ...actual,
    getConversation,
    updateMessageText: vi.fn(async () => {}),
    attachCatalogClickIfMatched: vi.fn(async () => {}),
    shouldBlockForAdsOnlyMode: vi.fn(async () => false),
    markGeoRestricted: vi.fn(async () => {}),
    recordOutgoingMessage: vi.fn(async () => {}),
    markSpecialistInvoked: vi.fn(async () => {}),
  };
});

vi.mock('../conversationEvents', () => ({ emitAiReplyStatus: vi.fn() }));
vi.mock('../mediaImageStore', () => ({ saveMediaImage: vi.fn(async () => {}) }));

let transcriptionCallCount = 0;
vi.mock('../geminiTranscription', () => ({
  transcribeAudio: vi.fn(async () => {
    transcriptionCallCount += 1;
    return { source: 'gemini', result: { transcription: `áudio número ${transcriptionCallCount}` } };
  }),
  isRealTranscriptionSource: (s: string) => s === 'groq' || s === 'gemini',
}));

vi.mock('../mediaDownload', () => ({
  downloadMetaMedia: vi.fn(async () => ({ base64: 'ZmFrZS1hdWRpbw==', mimeType: 'audio/ogg' })),
  downloadEvolutionMedia: vi.fn(async () => ({ base64: 'ZmFrZS1hdWRpbw==', mimeType: 'audio/ogg' })),
}));

vi.mock('../agentStatus', () => ({ isAgentPaused: vi.fn(async () => false) }));

vi.mock('../knowledgeBaseStore', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../knowledgeBaseStore')>();
  return { ...actual, getRuntimeKnowledgeBase: vi.fn(async () => ({ knowledgeBase: null, source: 'published_documents' as const })) };
});

vi.mock('../tenantProfileStore', () => ({ getTenantSegment: vi.fn(async () => 'geral') }));

vi.mock('../escalationStore', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../escalationStore')>();
  return { ...actual, logEscalation: vi.fn(async () => {}) };
});

const { processJob } = await import('../transcriptionQueue');

const TENANT_ID = 'tenant-carmen';
const PHONE = '595987468461';

function makeAudioJob(messageId: string) {
  return {
    message: {
      provider: 'evolution' as const,
      instanceName: 'inst-1',
      messageId,
      from: PHONE,
      contactName: 'Carmen',
      type: 'audio' as const,
      evolutionAudio: {},
    },
    resolvedTenant: {
      tenantId: TENANT_ID,
      provider: 'evolution' as const,
      evolutionInstanceName: 'inst-1',
      evolutionApiUrl: 'https://evo.example',
      evolutionApiKey: 'key',
    },
    createdAt: new Date().toISOString(),
  };
}

beforeEach(() => {
  transcriptionCallCount = 0;
  generateAutoReplyForText.mockClear();
  getConversation.mockClear();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('processJob — agrupamento de áudio em rajada (TASK-0430)', () => {
  it('dois áudios da mesma cliente em sequência rápida geram UMA resposta só, com as transcrições combinadas (achado real: antes gerava 2 respostas separadas)', async () => {
    getConversation.mockResolvedValue({ phone: PHONE, messages: [], updatedAt: 'x', unreadCount: 0 } as any);

    await processJob(makeAudioJob('audio-1') as any, { getAi: () => ({} as any) });
    // 2º áudio chega 3s depois do 1º — ainda dentro da janela de silêncio de 10s.
    await vi.advanceTimersByTimeAsync(3_000);
    await processJob(makeAudioJob('audio-2') as any, { getAi: () => ({} as any) });
    // Espera o resto da janela de silêncio (contada a partir do 2º áudio).
    await vi.advanceTimersByTimeAsync(10_000);

    expect(generateAutoReplyForText).toHaveBeenCalledTimes(1);
    const [, , textArg] = generateAutoReplyForText.mock.calls[0] as any[];
    expect(textArg).toBe('áudio número 1\náudio número 2');
  });

  it('um único áudio isolado (sem rajada) continua gerando uma resposta normalmente, sem regressão', async () => {
    getConversation.mockResolvedValue({ phone: PHONE, messages: [], updatedAt: 'x', unreadCount: 0 } as any);

    await processJob(makeAudioJob('audio-solo') as any, { getAi: () => ({} as any) });
    await vi.advanceTimersByTimeAsync(10_000);

    expect(generateAutoReplyForText).toHaveBeenCalledTimes(1);
    const [, , textArg] = generateAutoReplyForText.mock.calls[0] as any[];
    expect(textArg).toBe('áudio número 1');
  });
});
