/**
 * Resposta a uma pergunta real do dono do produto: hoje o sistema só decide
 * "provavelmente é um comprovante" pelo CONTEXTO (imagem + agendamento ativo
 * sem pagamento) — nunca olhava o conteúdo da foto. analyzePaymentReceiptWithGemini
 * gera uma dica curta pro operador decidir mais rápido, sem nunca confirmar
 * pagamento sozinha.
 */
import { describe, expect, it } from 'vitest';
import type { GoogleGenAI } from '@google/genai';
import { analyzePaymentReceiptWithGemini } from '../paymentReceiptAnalysis';

describe('analyzePaymentReceiptWithGemini', () => {
  it('devolve a dica quando o Gemini reconhece um comprovante', async () => {
    const fakeAi = {
      models: {
        generateContent: async () => ({
          text: JSON.stringify({ looksLikeReceipt: true, hint: 'Transferência de Gs 50.000, 12/08, banco Itaú' }),
        }) as any,
      },
    } as unknown as GoogleGenAI;

    const result = await analyzePaymentReceiptWithGemini(fakeAi, 'ZmFrZS1pbWFnZQ==', 'image/jpeg');

    expect(result?.looksLikeReceipt).toBe(true);
    expect(result?.hint).toBe('Transferência de Gs 50.000, 12/08, banco Itaú');
  });

  it('devolve looksLikeReceipt=false com uma dica descritiva quando não parece comprovante', async () => {
    const fakeAi = {
      models: {
        generateContent: async () => ({
          text: JSON.stringify({ looksLikeReceipt: false, hint: 'Parece uma selfie, não um comprovante' }),
        }) as any,
      },
    } as unknown as GoogleGenAI;

    const result = await analyzePaymentReceiptWithGemini(fakeAi, 'ZmFrZS1pbWFnZQ==', 'image/jpeg');

    expect(result?.looksLikeReceipt).toBe(false);
    expect(result?.hint).toBe('Parece uma selfie, não um comprovante');
  });

  it('null quando não há cliente Gemini configurado — nunca lança', async () => {
    const result = await analyzePaymentReceiptWithGemini(null, 'ZmFrZS1pbWFnZQ==', 'image/jpeg');
    expect(result).toBeNull();
  });

  it('null quando a chamada ao Gemini falha (mesmo depois do retry) — nunca lança', async () => {
    const fakeAi = {
      models: {
        generateContent: async () => {
          throw new Error('Gemini indisponível (simulado no teste)');
        },
      },
    } as unknown as GoogleGenAI;

    const result = await analyzePaymentReceiptWithGemini(fakeAi, 'ZmFrZS1pbWFnZQ==', 'image/jpeg');
    expect(result).toBeNull();
  }, 10000);

  it('null quando falta a imagem em base64', async () => {
    const fakeAi = { models: { generateContent: async () => ({ text: '{}' }) as any } } as unknown as GoogleGenAI;
    const result = await analyzePaymentReceiptWithGemini(fakeAi, '', 'image/jpeg');
    expect(result).toBeNull();
  });
});
