/**
 * TASK-0453 — contraparte de áudio de webhooksLeadsOnlyKeywordGates.test.ts
 * (ver comentário lá pro achado completo). Num tenant leadsOnly, os
 * gatilhos `isPaymentRelated`/`looksLikeHarassment` sobre a TRANSCRIÇÃO do
 * áudio deixam de disparar imediatamente (antes da IA) e passam a
 * depender de `result.outOfScope`: se a IA confirmar que é mensagem
 * pessoal, nunca escala; se confirmar que é do negócio, escala do mesmo
 * jeito, só depois. Tenant não-leadsOnly continua escalando imediatamente,
 * como sempre.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const generateAutoReplyForText = vi.fn();
vi.mock('../autoReply', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../autoReply')>();
  return { ...actual, generateAutoReplyForText };
});

const getConversation = vi.fn(async (_tenantId: string, _phone: string): Promise<any> => null);
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

let transcriptionText = 'Ya pago, gracias';
vi.mock('../geminiTranscription', () => ({
  transcribeAudio: vi.fn(async () => ({ source: 'gemini', result: { transcription: transcriptionText } })),
  isRealTranscriptionSource: (s: string) => s === 'groq' || s === 'gemini',
}));

vi.mock('../mediaDownload', () => ({
  downloadMetaMedia: vi.fn(async () => ({ base64: 'ZmFrZS1hdWRpbw==', mimeType: 'audio/ogg' })),
  downloadEvolutionMedia: vi.fn(async () => ({ base64: 'ZmFrZS1hdWRpbw==', mimeType: 'audio/ogg' })),
}));

let leadsOnlyMock = false;
vi.mock('../agentStatus', () => ({
  isAgentPaused: vi.fn(async () => false),
  isLeadsOnlyMode: vi.fn(async () => leadsOnlyMock),
}));

vi.mock('../knowledgeBaseStore', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../knowledgeBaseStore')>();
  return { ...actual, getRuntimeKnowledgeBase: vi.fn(async () => ({ knowledgeBase: null, source: 'published_documents' as const })) };
});

vi.mock('../tenantProfileStore', () => ({ getTenantSegment: vi.fn(async () => 'geral') }));

const logEscalation = vi.fn(async (..._args: unknown[]): Promise<void> => {});
vi.mock('../escalationStore', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../escalationStore')>();
  return { ...actual, logEscalation };
});

const { processJob } = await import('../transcriptionQueue');

function draftResult(outOfScope: boolean) {
  return {
    phase: 'abertura' as const,
    bubbles: outOfScope ? [] : ['Perfeito!'],
    agent: 'triagem' as const,
    needsHumanConfirmation: false,
    stopAutoReply: false,
    routerElapsedMs: 0,
    outOfScope,
  };
}

const TENANT_ID = 'tenant-leads-only-audio';

// Telefone distinto por teste — o buffer de áudio (audioMessageBuffer.ts) é
// um Map em memória no módulo, indexado por telefone, que não é resetado
// entre testes; reusar o mesmo número entre casos deixava estado de um
// teste (lock de geração, buffer pendente) vazar pro próximo.
function makeAudioJob(messageId: string, phone: string) {
  return {
    message: {
      provider: 'evolution' as const,
      instanceName: 'inst-1',
      messageId,
      from: phone,
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

function paymentCalls() {
  return logEscalation.mock.calls.filter((args: unknown[]) => args[3] === 'Áudio sobre pagamento/transferência — nunca confirmar automaticamente, requer verificação humana');
}

beforeEach(() => {
  transcriptionText = 'Ya pago, gracias';
  leadsOnlyMock = false;
  generateAutoReplyForText.mockClear();
  getConversation.mockClear();
  reviewAutoReplyBeforeSend.mockClear();
  sendBubbles.mockClear();
  logEscalation.mockClear();
  reviewAutoReplyBeforeSend.mockResolvedValue({ approved: true, source: 'rules', severity: 'low', reason: 'ok' });
  getConversation.mockImplementation(async (_tenantId: string, phone: string) => ({ phone, messages: [], updatedAt: 'x', unreadCount: 0 } as any));
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('processJob — áudio com conteúdo de pagamento e tenant leadsOnly (TASK-0453)', () => {
  it('tenant não-leadsOnly (padrão): escala IMEDIATAMENTE, nem espera a IA responder', async () => {
    leadsOnlyMock = false;
    let resolveAi: ((value: ReturnType<typeof draftResult>) => void) | null = null;
    generateAutoReplyForText.mockImplementationOnce(() => new Promise((resolve) => { resolveAi = resolve; }));

    await processJob(makeAudioJob('audio-1', '595985868801') as any, { getAi: () => ({} as any) });

    // Escala antes mesmo de a resposta da IA existir.
    expect(paymentCalls()).toHaveLength(1);

    resolveAi?.(draftResult(false));
    await vi.advanceTimersByTimeAsync(10_000);
  });

  it('tenant leadsOnly + IA confirma outOfScope: nunca escala', async () => {
    leadsOnlyMock = true;
    generateAutoReplyForText.mockResolvedValueOnce(draftResult(true));

    await processJob(makeAudioJob('audio-2', '595985868802') as any, { getAi: () => ({} as any) });

    // Logo após a transcrição, ainda não escalou (adiado pra depois da IA).
    expect(paymentCalls()).toHaveLength(0);

    await vi.advanceTimersByTimeAsync(10_000);

    expect(paymentCalls()).toHaveLength(0);
  });

  it('tenant leadsOnly + IA confirma que É do negócio: escala do mesmo jeito, só mais tarde', async () => {
    leadsOnlyMock = true;
    generateAutoReplyForText.mockResolvedValueOnce(draftResult(false));

    await processJob(makeAudioJob('audio-3', '595985868803') as any, { getAi: () => ({} as any) });

    expect(paymentCalls()).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(10_000);

    expect(paymentCalls()).toHaveLength(1);
  });
});
