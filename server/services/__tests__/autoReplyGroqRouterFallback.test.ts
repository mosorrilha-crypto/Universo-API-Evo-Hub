/**
 * Router fallback Groq (plano aprovado, 16/08/2026): classifyAgent tenta o
 * Groq primeiro (1 tentativa, sem retry) quando uma groqApiKey é passada, e
 * cai pro Gemini de sempre em qualquer falha — rede, timeout, JSON
 * malformado, ou "agent" fora do enum. Sem groqApiKey, o comportamento é
 * 100% o de antes (só Gemini) — coberto pelos testes já existentes de
 * autoReply.test.ts, que nunca passam esse parâmetro.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { GoogleGenAI } from '@google/genai';

vi.mock('../metaSend', () => ({ uploadWhatsAppMedia: vi.fn(), sendWhatsAppMediaMessage: vi.fn() }));
vi.mock('../conversationStore', () => ({ recordOutgoingMessage: vi.fn(async () => ({}) as any) }));
vi.mock('../knowledgeBaseStore', () => ({
  getKnowledgeBase: vi.fn(async () => ({ products: [] })),
  resolveProductPriceAmount: vi.fn(() => 0),
  isNonBookableProduct: vi.fn(() => false),
}));

const { generateAutoReplyForText } = await import('../autoReply');

const SPECIALIST_REPLY = { phase: 'informacao', bubbles: ['Oi! Tudo certo.'], needsHumanConfirmation: false };

const originalFetch = global.fetch;
afterEach(() => {
  global.fetch = originalFetch;
});

function fakeGemini(routerAgent: string) {
  let generateContentCalls = 0;
  const ai = {
    models: {
      generateContent: async (req: any) => {
        generateContentCalls += 1;
        const isRouterCall = req.contents[0].text.includes('Classifique a intenção principal');
        if (isRouterCall) return { text: JSON.stringify({ agent: routerAgent }) } as any;
        return { text: JSON.stringify(SPECIALIST_REPLY) } as any;
      },
    },
  } as unknown as GoogleGenAI;
  return { ai, getGenerateContentCalls: () => generateContentCalls };
}

function mockGroqFetch(response: { agent?: string; malformed?: boolean; httpStatus?: number }) {
  global.fetch = vi.fn(async () => {
    if (response.httpStatus) {
      return { ok: false, status: response.httpStatus, text: async () => 'erro simulado' } as Response;
    }
    if (response.malformed) {
      return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: 'não é json' } }] }) } as Response;
    }
    return {
      ok: true,
      status: 200,
      json: async () => ({ choices: [{ message: { content: JSON.stringify({ agent: response.agent, confidence: 0.8, reasoning: 'ok' }) } }] }),
    } as Response;
  });
}

describe('classifyAgent — router fallback Groq → Gemini', () => {
  it('usa o resultado do Groq e NUNCA chama o Gemini quando o Groq responde válido', async () => {
    mockGroqFetch({ agent: 'faq' });
    const { ai, getGenerateContentCalls } = fakeGemini('triagem'); // se o Gemini fosse chamado, classificaria diferente

    const result = await generateAutoReplyForText(
      'tenant-a',
      ai,
      'quanto custa o retoque?',
      'Cliente Teste',
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      'fake-groq-key'
    );

    expect(result).not.toBeNull();
    // Só a chamada do especialista foi ao Gemini (router não foi) — 1 chamada.
    expect(getGenerateContentCalls()).toBe(1);
  });

  it('cai pro Gemini quando o Groq devolve HTTP não-2xx', async () => {
    mockGroqFetch({ httpStatus: 500 });
    const { ai, getGenerateContentCalls } = fakeGemini('faq');

    const result = await generateAutoReplyForText(
      'tenant-a', ai, 'oi', 'Cliente', undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, 'fake-groq-key'
    );

    expect(result).not.toBeNull();
    // Router (Gemini, já que Groq falhou) + especialista = 2 chamadas.
    expect(getGenerateContentCalls()).toBe(2);
  });

  it('cai pro Gemini quando o Groq devolve JSON malformado', async () => {
    mockGroqFetch({ malformed: true });
    const { ai, getGenerateContentCalls } = fakeGemini('faq');

    const result = await generateAutoReplyForText(
      'tenant-a', ai, 'oi', 'Cliente', undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, 'fake-groq-key'
    );

    expect(result).not.toBeNull();
    expect(getGenerateContentCalls()).toBe(2);
  });

  it('cai pro Gemini quando o Groq devolve um "agent" fora do enum esperado', async () => {
    mockGroqFetch({ agent: 'categoria_inventada' });
    const { ai, getGenerateContentCalls } = fakeGemini('reclamacao');

    const result = await generateAutoReplyForText(
      'tenant-a', ai, 'oi', 'Cliente', undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, 'fake-groq-key'
    );

    expect(result).not.toBeNull();
    expect(getGenerateContentCalls()).toBe(2);
  });

  it('sem groqApiKey, nunca chama fetch — comportamento inalterado (só Gemini)', async () => {
    const fetchSpy = vi.fn();
    global.fetch = fetchSpy as any;
    const { ai, getGenerateContentCalls } = fakeGemini('faq');

    const result = await generateAutoReplyForText('tenant-a', ai, 'oi', 'Cliente');

    expect(result).not.toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(getGenerateContentCalls()).toBe(2);
  });
});
