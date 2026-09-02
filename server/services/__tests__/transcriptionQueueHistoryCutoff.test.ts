/**
 * TASK-0209 — achado real de auditoria estrutural (mesma classe do
 * TASK-0172, achada aqui no caminho de ÁUDIO): `processJob` cortava o
 * histórico por POSIÇÃO (`slice(0, -1)`), assumindo que o próprio áudio é
 * sempre o último item de `conversation.messages`. Cenário de corrida real:
 * entre o cliente mandar o áudio (gravado na hora, fora da fila) e o job de
 * transcrição rodar (fila serial única + download + Gemini — latência real
 * de segundos), o mesmo cliente pode mandar uma mensagem NOVA — também
 * gravada na hora. Quando isso acontece, `conversation.messages` já tem
 * [...histórico, áudio(transcrito), mensagem-nova] no momento em que o job
 * roda: cortar a ÚLTIMA posição remove a mensagem nova (perdida do
 * contexto) e mantém o áudio duplicado dentro do histórico.
 *
 * Mocka todas as dependências de I/O do processJob (mesmo padrão de
 * webhooksOperatorActivePause.test.ts) — só captura o `history` recebido
 * por generateAutoReplyForText, que é o único ponto que importa aqui.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const generateAutoReplyForText = vi.fn(async () => null);
vi.mock('../autoReply', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../autoReply')>();
  return { ...actual, generateAutoReplyForText };
});

const getConversation = vi.fn();
const updateMessageText = vi.fn(async () => {});
const attachCatalogClickIfMatched = vi.fn(async () => {});
const shouldBlockForAdsOnlyMode = vi.fn(async () => false);
vi.mock('../conversationStore', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../conversationStore')>();
  return { ...actual, getConversation, updateMessageText, attachCatalogClickIfMatched, shouldBlockForAdsOnlyMode, markGeoRestricted: vi.fn(async () => {}), recordOutgoingMessage: vi.fn(async () => {}) };
});

vi.mock('../conversationEvents', () => ({ emitAiReplyStatus: vi.fn() }));

vi.mock('../mediaImageStore', () => ({ saveMediaImage: vi.fn(async () => {}) }));

vi.mock('../geminiTranscription', () => ({
  transcribeAudioWithGemini: vi.fn(async () => ({
    source: 'gemini',
    result: { transcription: '¿Y la duración del procedimiento?' },
  })),
}));

vi.mock('../mediaDownload', () => ({
  downloadMetaMedia: vi.fn(async () => ({ base64: 'ZmFrZS1hdWRpbw==', mimeType: 'audio/ogg' })),
  downloadEvolutionMedia: vi.fn(async () => ({ base64: 'ZmFrZS1hdWRpbw==', mimeType: 'audio/ogg' })),
}));

const isAgentPaused = vi.fn(async () => false);
vi.mock('../agentStatus', () => ({ isAgentPaused }));

vi.mock('../knowledgeBaseStore', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../knowledgeBaseStore')>();
  return { ...actual, getKnowledgeBase: vi.fn(async () => null) };
});

vi.mock('../tenantProfileStore', () => ({ getTenantSegment: vi.fn(async () => 'geral') }));

const logEscalation = vi.fn(async () => {});
vi.mock('../escalationStore', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../escalationStore')>();
  return { ...actual, logEscalation };
});

const { processJob } = await import('../transcriptionQueue');

const TENANT_ID = 'tenant-a';
const AUDIO_MESSAGE_ID = 'wamid.audio-123';

function makeJob() {
  return {
    message: {
      provider: 'meta' as const,
      messageId: AUDIO_MESSAGE_ID,
      from: '595981234567',
      contactName: 'Cliente Teste',
      type: 'audio' as const,
      metaAudio: { mediaId: 'media-1' },
    },
    resolvedTenant: {
      tenantId: TENANT_ID,
      provider: 'meta' as const,
      metaAccessToken: 'token',
      metaPhoneNumberId: 'phone-id',
    },
    createdAt: new Date().toISOString(),
  };
}

function waitForCall(mock: ReturnType<typeof vi.fn>, timeoutMs = 500): Promise<void> {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const check = () => {
      if (mock.mock.calls.length > 0) return resolve();
      if (Date.now() - start > timeoutMs) return reject(new Error('mock não foi chamado a tempo'));
      setTimeout(check, 5);
    };
    check();
  });
}

describe('processJob — corte de histórico no caminho de áudio', () => {
  beforeEach(() => {
    generateAutoReplyForText.mockClear();
    getConversation.mockClear();
  });

  it('exclui o próprio áudio do histórico por IDENTIDADE, preservando uma mensagem nova chegada depois dele (corrida real)', async () => {
    // Reproduz a corrida: o áudio (já com texto transcrito, updateMessageText
    // já rodou) NÃO é o último item — uma mensagem nova do cliente chegou
    // depois dele, gravada fora da fila de transcrição.
    getConversation.mockResolvedValueOnce({
      phone: '595981234567',
      messages: [
        { id: 'm-0', sender: 'lead', type: 'text', text: 'Hola, quería preguntar algo', timestamp: '2026-09-02T10:00:00.000Z' },
        { id: AUDIO_MESSAGE_ID, sender: 'lead', sentBy: undefined, type: 'text', text: '¿Y la duración del procedimiento?', timestamp: '2026-09-02T10:00:05.000Z' },
        { id: 'm-nova', sender: 'lead', type: 'text', text: 'Ah, y también quería saber el precio', timestamp: '2026-09-02T10:00:08.000Z' },
      ],
      updatedAt: 'x',
      unreadCount: 0,
    } as any);

    await processJob(makeJob(), { getAi: () => ({} as any) });
    await waitForCall(generateAutoReplyForText);

    const historyArg = (generateAutoReplyForText.mock.calls[0] as any[])[5];
    expect(historyArg.map((m: any) => m.id)).toEqual(['m-0']);
    // Confirma explicitamente as duas falhas que o corte por posição causava:
    expect(historyArg.some((m: any) => m.id === AUDIO_MESSAGE_ID)).toBe(false); // nunca duplica o próprio áudio
    expect(historyArg.some((m: any) => m.id === 'm-nova')).toBe(false); // a mensagem nova NÃO é história — ela é perdida do contexto de qualquer forma nesta chamada (é responsabilidade de uma rodada seguinte), mas o importante é que o corte não a inclua por engano nem a troque pelo áudio
  });

  it('cai no corte por posição (comportamento antigo) quando o id do áudio não é encontrado no histórico — nunca quebra', async () => {
    getConversation.mockResolvedValueOnce({
      phone: '595981234567',
      messages: [
        { id: 'm-0', sender: 'lead', type: 'text', text: 'Hola', timestamp: '2026-09-02T10:00:00.000Z' },
        { id: 'm-outro-id-qualquer', sender: 'lead', type: 'text', text: '¿Y la duración del procedimiento?', timestamp: '2026-09-02T10:00:05.000Z' },
      ],
      updatedAt: 'x',
      unreadCount: 0,
    } as any);

    await processJob(makeJob(), { getAi: () => ({} as any) });
    await waitForCall(generateAutoReplyForText);

    const historyArg = (generateAutoReplyForText.mock.calls[0] as any[])[5];
    expect(historyArg.map((m: any) => m.id)).toEqual(['m-0']);
  });
});
