/**
 * TASK-0432 — mesmo achado real da contraparte de texto
 * (webhooksBufferLateMessageSlowGeneration.test.ts), aplicado ao caminho de
 * áudio: a proteção de absorção de mensagem tardia (aqui,
 * takePendingAudioBufferTexts) só funciona se o áudio novo ainda estiver
 * esperando no buffer no momento em que a resposta anterior termina de ser
 * GERADA — mas gerar uma resposta real leva bem mais que os 10s de silêncio
 * do buffer de áudio (audioMessageBuffer.ts). Sem generatingLock.ts, um 2º
 * áudio cujo próprio buffer vencesse os 10s ANTES da 1ª geração terminar
 * disparava seu próprio ciclo independente, gerando 2 respostas separadas
 * pra uma cliente que só queria dizer mais uma coisa rapidamente.
 *
 * Este teste segue o mesmo padrão de transcriptionQueueAudioBatching.test.ts
 * (TASK-0430), mas com a 1ª geração "presa" numa promise controlada — avança
 * o tempo COMPLETO da janela de silêncio do 2º áudio ANTES de resolver a 1ª,
 * reproduzindo a corrida real.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const generateAutoReplyForText = vi.fn();
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

const reviewAutoReplyBeforeSend = vi.fn(async () => ({ approved: true, source: 'rules' as const, severity: 'low' as const, reason: 'ok' }));
vi.mock('../replySafetyGate', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../replySafetyGate')>();
  return { ...actual, reviewAutoReplyBeforeSend };
});

const sendBubbles = vi.fn(async (_channel: any, _phone: string, bubbles: string[], onBubbleSent: (text: string) => Promise<void>) => {
  for (const bubble of bubbles) await onBubbleSent(bubble);
});
vi.mock('../sendBubbles', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../sendBubbles')>();
  return { ...actual, sendBubbles };
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

function draftResult(bubbles: string[]) {
  return {
    phase: 'abertura' as const,
    bubbles,
    agent: 'triagem' as const,
    needsHumanConfirmation: false,
    stopAutoReply: false,
    routerElapsedMs: 0,
  };
}

const TENANT_ID = 'tenant-slow-audio';
const PHONE = '595985868809';

function makeAudioJob(messageId: string) {
  return {
    message: {
      provider: 'evolution' as const,
      instanceName: 'inst-1',
      messageId,
      from: PHONE,
      contactName: 'Cliente',
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
  reviewAutoReplyBeforeSend.mockClear();
  sendBubbles.mockClear();
  reviewAutoReplyBeforeSend.mockResolvedValue({ approved: true, source: 'rules', severity: 'low', reason: 'ok' });
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('processJob — absorve áudio tardio mesmo quando a geração da 1ª resposta demora mais que a janela de silêncio do 2º áudio (TASK-0432)', () => {
  it('nunca deixa o 2º áudio disparar seu próprio ciclo — o flush dele adia até a 1ª geração terminar, e é absorvido', async () => {
    getConversation.mockResolvedValue({ phone: PHONE, messages: [], updatedAt: 'x', unreadCount: 0 } as any);

    let resolveFirstCall: ((value: ReturnType<typeof draftResult>) => void) | null = null;
    generateAutoReplyForText.mockImplementationOnce(
      () => new Promise((resolve) => { resolveFirstCall = resolve; })
    );
    generateAutoReplyForText.mockResolvedValueOnce(draftResult(['Dale, perfecto']));

    await processJob(makeAudioJob('audio-1') as any, { getAi: () => ({} as any) });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(generateAutoReplyForText).toHaveBeenCalledTimes(1);
    expect(resolveFirstCall).not.toBeNull();

    // 2º áudio chega enquanto a 1ª geração ainda está presa.
    await processJob(makeAudioJob('audio-2') as any, { getAi: () => ({} as any) });

    // Passa os 10s completos de silêncio do 2º áudio — no código antigo
    // (sem TASK-0432), isso disparava o flush dele agora, mesmo com a 1ª
    // geração ainda presa. Com a correção, o flush deve adiar.
    await vi.advanceTimersByTimeAsync(10_000);
    expect(generateAutoReplyForText).toHaveBeenCalledTimes(1); // nada novo disparou sozinho

    resolveFirstCall!(draftResult(['Rascunho stale, nunca deveria ser enviado']));
    await vi.advanceTimersByTimeAsync(100);

    // Absorção: takePendingAudioBufferTexts encontra o 2º áudio ainda
    // pendente e regenera com o texto combinado.
    expect(generateAutoReplyForText).toHaveBeenCalledTimes(2);
    const secondCallArgs = generateAutoReplyForText.mock.calls[1] as any[];
    expect(secondCallArgs[2]).toBe('áudio número 1\náudio número 2');

    // Só uma resposta é enviada no total — a regenerada (combinada), nunca
    // o rascunho stale da 1ª geração (que nem viu o 2º áudio).
    expect(sendBubbles).toHaveBeenCalledTimes(1);
    const sentBubbles = (sendBubbles.mock.calls[0] as any[])[2];
    expect(sentBubbles).toEqual(['Dale, perfecto']);

    await vi.advanceTimersByTimeAsync(15_000);
    expect(generateAutoReplyForText).toHaveBeenCalledTimes(2);
  });
});
