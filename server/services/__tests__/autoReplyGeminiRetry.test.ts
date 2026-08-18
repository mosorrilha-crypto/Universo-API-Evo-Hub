/**
 * Issue #82, item 4: falha transitória do Gemini (timeout, 429, erro de
 * rede) tinha zero tentativa extra — a primeira exceção já fazia
 * generateAutoReplyForText devolver null, e server/routes/webhooks.ts só
 * registrava um escalonamento sem mandar nada pro cliente (silêncio total).
 * Este teste trava que agora existe retry com backoff curto antes de
 * desistir de vez.
 */
import { describe, expect, it, vi } from 'vitest';
import type { GoogleGenAI } from '@google/genai';

vi.mock('../metaSend', () => ({ uploadWhatsAppMedia: vi.fn(), sendWhatsAppMediaMessage: vi.fn() }));
vi.mock('../conversationStore', () => ({ recordOutgoingMessage: vi.fn(async () => ({}) as any) }));
vi.mock('../knowledgeBaseStore', () => ({
  getKnowledgeBase: vi.fn(async () => ({ products: [] })),
  resolveProductPriceAmount: vi.fn(() => 0),
  isNonBookableProduct: vi.fn(() => false),
  findProductDurationMinutes: vi.fn(() => undefined),
}));

const { generateAutoReplyForText } = await import('../autoReply');

const SPECIALIST_REPLY = { phase: 'informacao', bubbles: ['Oi! Tudo certo.'], needsHumanConfirmation: false };

describe('generateAutoReplyForText — retry/backoff em falha transitória do Gemini (issue #82 item 4)', () => {
  it('recupera de uma falha transitória isolada (não desiste na 1ª exceção)', async () => {
    let callCount = 0;
    const ai = {
      models: {
        generateContent: async (req: any) => {
          callCount += 1;
          const isRouterCall = req.contents[0].text.includes('Classifique a intenção principal');
          // Só a 1ª chamada de router falha uma vez — as seguintes funcionam normalmente.
          if (isRouterCall && callCount === 1) {
            throw new Error('ECONNRESET simulado');
          }
          if (isRouterCall) return { text: JSON.stringify({ agent: 'faq' }) } as any;
          return { text: JSON.stringify(SPECIALIST_REPLY) } as any;
        },
      },
    } as unknown as GoogleGenAI;

    const result = await generateAutoReplyForText('tenant-a', ai, 'oi, quanto custa?', 'Cliente Teste');

    expect(result).not.toBeNull();
    expect(result?.bubbles).toEqual(SPECIALIST_REPLY.bubbles);
    expect(callCount).toBeGreaterThan(1);
  }, 10000);

  it('ainda devolve null (nunca lança) quando a falha persiste em todas as tentativas', async () => {
    let callCount = 0;
    const ai = {
      models: {
        generateContent: async () => {
          callCount += 1;
          throw new Error('Gemini indisponível simulado');
        },
      },
    } as unknown as GoogleGenAI;

    const result = await generateAutoReplyForText('tenant-a', ai, 'oi', 'Cliente Teste');

    expect(result).toBeNull();
    // 1 tentativa original + 2 retries configurados = 3 chamadas ao todo.
    expect(callCount).toBe(3);
  }, 10000);
});
