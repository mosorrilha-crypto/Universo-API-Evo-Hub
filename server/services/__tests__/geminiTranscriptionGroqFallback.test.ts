/**
 * TASK-0352 — transcrição de áudio via Groq/Whisper (primeira tentativa,
 * mesmo padrão Groq-primeiro-Gemini-de-fallback já usado no resto do
 * projeto). Whisper só transcreve; uma segunda chamada Groq (texto puro)
 * deriva o resto da análise (summary/intent/sentiment/keyPoints/
 * suggestedReply/urgencyScore) a partir da transcrição literal. Qualquer
 * falha em QUALQUER uma das duas chamadas cai pro caminho 100% Gemini já
 * existente (transcribeAudioWithGemini) — nunca uma transcrição "órfã" sem
 * o resto dos campos.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { GoogleGenAI } from '@google/genai';

vi.mock('../audioTranscode', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../audioTranscode')>();
  return { ...actual, isAudioEffectivelySilent: vi.fn(async () => false) };
});

const { transcribeAudio } = await import('../geminiTranscription');

const originalFetch = global.fetch;
afterEach(() => {
  global.fetch = originalFetch;
  vi.clearAllMocks();
});

function fakeGemini(): GoogleGenAI {
  return {
    models: {
      generateContent: async () => ({
        text: JSON.stringify({
          transcription: 'transcrição via gemini',
          language: 'Português',
          summary: 'resumo gemini',
          intent: 'duvida',
          sentiment: 'Neutro',
          keyPoints: [],
          suggestedReply: 'ok',
          urgencyScore: 2,
        }),
      }),
    },
  } as unknown as GoogleGenAI;
}

/** Roteia por URL: transcrição (Whisper) e análise de texto (chat completions) usam endpoints diferentes do Groq. */
function mockGroqFetch(opts: { transcription?: unknown; transcriptionStatus?: number; analysis?: unknown; analysisStatus?: number }) {
  global.fetch = vi.fn(async (url: any) => {
    if (typeof url === 'string' && url.includes('/audio/transcriptions')) {
      if (opts.transcriptionStatus) {
        return { ok: false, status: opts.transcriptionStatus, text: async () => 'erro simulado' } as Response;
      }
      return { ok: true, status: 200, json: async () => opts.transcription } as Response;
    }
    if (opts.analysisStatus) {
      return { ok: false, status: opts.analysisStatus, text: async () => 'erro simulado' } as Response;
    }
    return {
      ok: true,
      status: 200,
      json: async () => ({ choices: [{ message: { content: JSON.stringify(opts.analysis) } }] }),
    } as Response;
  });
}

describe('transcribeAudio — Groq/Whisper primeiro, Gemini de fallback', () => {
  it('usa a transcrição do Whisper + análise do Groq quando os dois funcionam, sem chamar o Gemini', async () => {
    const ai = fakeGemini();
    const generateContentSpy = vi.spyOn(ai.models, 'generateContent');
    mockGroqFetch({
      transcription: { text: 'Hola, quería preguntar el precio', language: 'spanish' },
      analysis: { language: 'Español (Paraguay)', summary: 'Cliente pergunta o preço', intent: 'preco', sentiment: 'Neutro', keyPoints: ['preço'], suggestedReply: 'Claro, te paso los precios', urgencyScore: 2 },
    });

    const outcome = await transcribeAudio(ai, 'ZmFrZS1hdWRpbw==', 'audio/ogg', { groqApiKey: 'fake-groq-key' });

    expect(outcome.source).toBe('groq');
    expect(outcome.result.transcription).toBe('Hola, quería preguntar el precio');
    expect(outcome.result.summary).toBe('Cliente pergunta o preço');
    expect(generateContentSpy).not.toHaveBeenCalled();
  });

  it('cai pro Gemini quando o Whisper (transcrição) falha com HTTP não-2xx', async () => {
    const ai = fakeGemini();
    mockGroqFetch({ transcriptionStatus: 500 });

    const outcome = await transcribeAudio(ai, 'ZmFrZS1hdWRpbw==', 'audio/ogg', { groqApiKey: 'fake-groq-key' });

    expect(outcome.source).toBe('gemini');
    expect(outcome.result.transcription).toBe('transcrição via gemini');
  });

  it('cai pro Gemini quando a 2ª chamada (análise de texto) falha — nunca devolve transcrição "órfã" sem o resto dos campos', async () => {
    const ai = fakeGemini();
    mockGroqFetch({
      transcription: { text: 'Hola, quería preguntar el precio' },
      analysisStatus: 500,
    });

    const outcome = await transcribeAudio(ai, 'ZmFrZS1hdWRpbw==', 'audio/ogg', { groqApiKey: 'fake-groq-key' });

    expect(outcome.source).toBe('gemini');
  });

  it('quando o Whisper devolve texto vazio (silêncio real), não chama a 2ª etapa de análise nem o Gemini', async () => {
    const ai = fakeGemini();
    const generateContentSpy = vi.spyOn(ai.models, 'generateContent');
    mockGroqFetch({ transcription: { text: '   ' } });

    const outcome = await transcribeAudio(ai, 'ZmFrZS1hdWRpbw==', 'audio/ogg', { groqApiKey: 'fake-groq-key' });

    expect(outcome.source).toBe('groq');
    expect(outcome.result.transcription).toBe('');
    expect(outcome.result.summary).toBe('Áudio sem fala inteligível detectada.');
    expect(generateContentSpy).not.toHaveBeenCalled();
  });

  it('sem groqApiKey, nunca chama fetch — comportamento inalterado (só Gemini)', async () => {
    const ai = fakeGemini();
    const fetchSpy = vi.fn();
    global.fetch = fetchSpy as any;

    const outcome = await transcribeAudio(ai, 'ZmFrZS1hdWRpbw==', 'audio/ogg', {});

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(outcome.source).toBe('gemini');
  });
});
