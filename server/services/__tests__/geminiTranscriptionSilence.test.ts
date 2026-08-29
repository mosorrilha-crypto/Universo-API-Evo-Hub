/**
 * Achado real de auditoria (29/08/2026): um áudio enviado deliberadamente
 * sem nenhuma fala (silêncio) voltou do Gemini com uma transcrição completa
 * e plausível de uma cliente perguntando preço/disponibilidade — 100%
 * inventada, já que não havia fala real no áudio. Isso alimentou o motor de
 * resposta automática como se fosse mensagem real da cliente (só não saiu
 * porque o revisor pré-envio bloqueou o rascunho gerado em cima dela). Ver
 * geminiTranscription.ts (prompt) e transcriptionQueue.ts (gate que nunca
 * dispara resposta automática nem some a mensagem quando não há fala real).
 */
import { describe, expect, it, vi } from 'vitest';
import type { GoogleGenAI } from '@google/genai';
import { transcribeAudioWithGemini } from '../geminiTranscription';

describe('transcribeAudioWithGemini — áudio sem fala real (silêncio/ruído)', () => {
  it('instrui o modelo a devolver transcription vazia em vez de inventar fala, quando não há fala real', async () => {
    let capturedContents: any;
    const fakeAi = {
      models: {
        generateContent: async (request: any) => {
          capturedContents = request.contents;
          return { text: JSON.stringify({ transcription: '', language: 'Desconhecido', summary: 'Áudio sem fala inteligível detectada.', intent: 'Desconhecido', sentiment: 'Neutro', keyPoints: [], suggestedReply: '', urgencyScore: 1 }) } as any;
        },
      },
    } as unknown as GoogleGenAI;

    await transcribeAudioWithGemini(fakeAi, 'ZmFrZS1hdWRpby1iYXNlNjQ=', 'audio/ogg');

    const promptText = capturedContents.find((part: any) => typeof part.text === 'string')?.text;
    expect(promptText).toContain('nunca invente uma fala plausível que a pessoa não disse');
    expect(promptText).toContain('transcription": ""');
  });

  it('devolve source "gemini" com transcription vazia quando o modelo reporta ausência de fala real (chamada teve sucesso técnico, não é o caminho de fallback)', async () => {
    const fakeAi = {
      models: {
        generateContent: vi.fn().mockResolvedValue({
          text: JSON.stringify({
            transcription: '',
            language: 'Desconhecido',
            summary: 'Áudio sem fala inteligível detectada.',
            intent: 'Desconhecido',
            sentiment: 'Neutro',
            keyPoints: [],
            suggestedReply: '',
            urgencyScore: 1,
          }),
        }),
      },
    } as unknown as GoogleGenAI;

    const outcome = await transcribeAudioWithGemini(fakeAi, 'ZmFrZS1hdWRpby1iYXNlNjQ=', 'audio/ogg');

    expect(outcome.source).toBe('gemini');
    expect(outcome.result.transcription).toBe('');
  });
});
