/**
 * Achado ao vivo (print real do painel: "[Não foi possível transcrever o
 * áudio no momento]" logo na primeira falha do Gemini): diferente de
 * autoReply.ts e das rotas de análise (PR #103), transcribeAudioWithGemini
 * nunca usava withGeminiRetry — uma falha transitória (503/429/timeout) caía
 * direto no fallback honesto sem nenhuma segunda tentativa.
 */
import { describe, expect, it, vi } from 'vitest';
import type { GoogleGenAI } from '@google/genai';
import { transcribeAudioWithGemini } from '../geminiTranscription';

describe('transcribeAudioWithGemini — retry em falha transitória', () => {
  it('tenta de novo antes de cair no fallback (withGeminiRetry de fato em uso, não só 1 tentativa)', async () => {
    let callCount = 0;
    const fakeAi = {
      models: {
        generateContent: async () => {
          callCount += 1;
          throw new Error('Gemini indisponível (simulado no teste)');
        },
      },
    } as unknown as GoogleGenAI;

    const outcome = await transcribeAudioWithGemini(fakeAi, 'ZmFrZS1hdWRpby1iYXNlNjQ=', 'audio/ogg');

    // 1 tentativa original + 2 retries configurados em withGeminiRetry = 3 chamadas ao todo.
    expect(callCount).toBe(3);
    expect(outcome.source).toBe('fallback');
    expect(outcome.result.transcription).toBe('[Não foi possível transcrever o áudio no momento]');
  }, 10000);

  it('usa o resultado real do Gemini quando a chamada funciona de primeira (sem esperar retry)', async () => {
    let callCount = 0;
    const fakeAi = {
      models: {
        generateContent: async () => {
          callCount += 1;
          return {
            text: JSON.stringify({
              transcription: 'Hola, quiero agendar una cita',
              language: 'Español (Paraguay)',
              summary: 'Cliente quer agendar',
              intent: 'Agendamento',
              sentiment: 'Positivo',
              keyPoints: ['Quer agendar'],
              suggestedReply: 'Claro, te ayudo con eso',
              urgencyScore: 3,
            }),
          } as any;
        },
      },
    } as unknown as GoogleGenAI;

    const outcome = await transcribeAudioWithGemini(fakeAi, 'ZmFrZS1hdWRpby1iYXNlNjQ=', 'audio/ogg');

    expect(callCount).toBe(1);
    expect(outcome.source).toBe('gemini');
    expect(outcome.result.transcription).toBe('Hola, quiero agendar una cita');
  });
});
