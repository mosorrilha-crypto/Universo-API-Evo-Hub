/**
 * TASK-0284: extractPaymentProofDataWithGemini tenta extrair campos
 * ESTRUTURADOS (valor, data, método) de uma imagem, ao contrário da
 * analyzePaymentReceiptWithGemini original (só uma dica em texto livre) —
 * usada quando o operador marca manualmente uma imagem do chat como
 * comprovante (menu "⋮" do balão). Nunca inventa/coage um valor que o
 * Gemini não devolveu certo.
 */
import { describe, expect, it } from 'vitest';
import type { GoogleGenAI } from '@google/genai';
import { extractPaymentProofDataWithGemini } from '../paymentReceiptAnalysis';

function fakeAiReturning(json: unknown): GoogleGenAI {
  return {
    models: {
      generateContent: async () => ({ text: JSON.stringify(json) }) as any,
    },
  } as unknown as GoogleGenAI;
}

describe('extractPaymentProofDataWithGemini', () => {
  it('devolve todos os campos quando o Gemini reconhece um comprovante completo', async () => {
    const fakeAi = fakeAiReturning({
      looksLikeReceipt: true,
      amount: 500000,
      currency: 'PYG',
      date: '2026-09-04',
      method: 'PIX',
      bankOrApp: 'Itaú',
      holderName: 'Maria Gonzalez',
      confidence: 'high',
      hint: 'Transferência de Gs 500.000, 04/09, banco Itaú',
    });

    const result = await extractPaymentProofDataWithGemini(fakeAi, 'ZmFrZS1pbWFnZQ==', 'image/jpeg');

    expect(result).toMatchObject({
      looksLikeReceipt: true,
      amount: 500000,
      currency: 'PYG',
      date: '2026-09-04',
      method: 'PIX',
      bankOrApp: 'Itaú',
      holderName: 'Maria Gonzalez',
      confidence: 'high',
    });
  });

  it('campos parciais/nulos ficam null — nunca inventa o que faltou', async () => {
    const fakeAi = fakeAiReturning({
      looksLikeReceipt: true,
      amount: null,
      currency: null,
      date: null,
      method: null,
      bankOrApp: null,
      holderName: null,
      confidence: 'low',
      hint: 'Parece um comprovante, mas o valor está ilegível',
    });

    const result = await extractPaymentProofDataWithGemini(fakeAi, 'ZmFrZS1pbWFnZQ==', 'image/jpeg');

    expect(result?.amount).toBeNull();
    expect(result?.date).toBeNull();
    expect(result?.method).toBeNull();
    expect(result?.confidence).toBe('low');
  });

  it('method inválido (fora da lista de PaymentMethod) vira null — nunca é coagido/adivinhado', async () => {
    const fakeAi = fakeAiReturning({
      looksLikeReceipt: true,
      amount: 100000,
      method: 'Dinheiro em espécie', // não é um PaymentMethod válido
      hint: 'Comprovante de pagamento em dinheiro',
    });

    const result = await extractPaymentProofDataWithGemini(fakeAi, 'ZmFrZS1pbWFnZQ==', 'image/jpeg');

    expect(result?.method).toBeNull();
    expect(result?.amount).toBe(100000);
  });

  it('looksLikeReceipt=false com hint descritivo quando não parece comprovante', async () => {
    const fakeAi = fakeAiReturning({ looksLikeReceipt: false, hint: 'Parece uma foto de produto, não um comprovante' });

    const result = await extractPaymentProofDataWithGemini(fakeAi, 'ZmFrZS1pbWFnZQ==', 'image/jpeg');

    expect(result?.looksLikeReceipt).toBe(false);
    expect(result?.hint).toBe('Parece uma foto de produto, não um comprovante');
    expect(result?.amount).toBeNull();
  });

  it('null quando não há cliente Gemini configurado — nunca lança', async () => {
    const result = await extractPaymentProofDataWithGemini(null, 'ZmFrZS1pbWFnZQ==', 'image/jpeg');
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

    const result = await extractPaymentProofDataWithGemini(fakeAi, 'ZmFrZS1pbWFnZQ==', 'image/jpeg');
    expect(result).toBeNull();
  }, 10000);

  it('null quando falta a imagem em base64', async () => {
    const fakeAi = fakeAiReturning({});
    const result = await extractPaymentProofDataWithGemini(fakeAi, '', 'image/jpeg');
    expect(result).toBeNull();
  });
});
