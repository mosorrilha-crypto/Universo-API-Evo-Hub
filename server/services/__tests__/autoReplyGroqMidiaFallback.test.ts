/**
 * Fallback Groq → Gemini pra decisão de foto/vídeo de exemplo (18/08/2026,
 * mesmo padrão do router — ver autoReplyGroqRouterFallback.test.ts):
 * runMidiaTool tenta o Groq primeiro (1 tentativa, sem retry) quando uma
 * groqApiKey é passada, e cai pro Gemini de sempre (function-calling) em
 * qualquer falha — rede, timeout, JSON malformado, ou "action" fora do
 * enum. Sem groqApiKey, o comportamento é 100% o de antes (só Gemini) —
 * coberto pelos testes já existentes de autoReply.test.ts, que nunca
 * passam esse parâmetro.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { GoogleGenAI } from '@google/genai';

const uploadWhatsAppMedia = vi.fn(async () => 'media-id-123');
const sendWhatsAppMediaMessage = vi.fn(async () => undefined);
const recordOutgoingMessage = vi.fn(async (..._args: any[]) => ({}) as any);
const PRODUCT_WITH_PHOTO = { name: 'Microlips', price: 'Gs 500.000', exampleImageBase64: 'data:image/jpeg;base64,QQ==', exampleImageMimeType: 'image/jpeg' };

vi.mock('../metaSend', () => ({ uploadWhatsAppMedia, sendWhatsAppMediaMessage }));
vi.mock('../conversationStore', () => ({ recordOutgoingMessage }));
vi.mock('../knowledgeBaseStore', () => ({
  getKnowledgeBase: vi.fn(async () => ({ products: [PRODUCT_WITH_PHOTO] })),
  resolveProductPriceAmount: vi.fn(() => 0),
  isNonBookableProduct: vi.fn(() => false),
  findProductDurationMinutes: vi.fn(() => undefined),
  findProductMatch: vi.fn((kb: { products: { name: string }[] } | null, name: string) => {
    const normalized = name.trim().toLowerCase();
    const product = kb?.products?.find((p) => p.name.trim().toLowerCase() === normalized);
    return product ? { product } : undefined;
  }),
}));

const { generateAutoReplyForText } = await import('../autoReply');

const SPECIALIST_REPLY = { phase: 'informacao', bubbles: ['Manda ver a foto!'], needsHumanConfirmation: false };
const MEDIA_CONFIG = { phoneNumberId: 'pn-1', accessToken: 'tok-1' };

const originalFetch = global.fetch;
afterEach(() => {
  global.fetch = originalFetch;
  uploadWhatsAppMedia.mockClear();
  sendWhatsAppMediaMessage.mockClear();
  recordOutgoingMessage.mockClear();
});

function fakeGemini() {
  let toolCalls = 0;
  const ai = {
    models: {
      generateContent: async (req: any) => {
        if (req.config?.tools) {
          toolCalls += 1;
          // Se o Gemini for chamado, decide diferente do Groq — dá pra distinguir quem decidiu.
          return { functionCalls: [{ name: 'enviar_foto_exemplo', args: { nome_produto: 'Microlips' } }] } as any;
        }
        if (req.contents[0].text.includes('Classifique a intenção principal')) return { text: JSON.stringify({ agent: 'faq' }) } as any;
        return { text: JSON.stringify(SPECIALIST_REPLY) } as any;
      },
    },
  } as unknown as GoogleGenAI;
  return { ai, getToolCalls: () => toolCalls };
}

function mockGroqFetch(response: { action?: string; nomeProduto?: string; malformed?: boolean; httpStatus?: number }) {
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
      json: async () => ({ choices: [{ message: { content: JSON.stringify({ action: response.action, nome_produto: response.nomeProduto ?? '' }) } }] }),
    } as Response;
  });
}

describe('runMidiaTool — fallback Groq → Gemini', () => {
  it('usa a decisão do Groq e NUNCA chama o Gemini com function-calling quando o Groq responde válido', async () => {
    mockGroqFetch({ action: 'enviar_foto_exemplo', nomeProduto: 'Microlips' });
    const { ai, getToolCalls } = fakeGemini();

    const result = await generateAutoReplyForText(
      'tenant-a', ai, 'tem foto do microlips?', 'Cliente', undefined, undefined,
      '595981234567', undefined, 'beauty_studio', MEDIA_CONFIG, undefined, undefined, undefined, 'fake-groq-key'
    );

    expect(result).not.toBeNull();
    expect(getToolCalls()).toBe(0);
    expect(uploadWhatsAppMedia).toHaveBeenCalledWith('pn-1', 'tok-1', expect.any(Buffer), 'image/jpeg', expect.stringContaining('Microlips'));
  });

  it('Groq decidindo "nenhuma" não manda mídia nem chama o Gemini', async () => {
    mockGroqFetch({ action: 'nenhuma' });
    const { ai, getToolCalls } = fakeGemini();

    await generateAutoReplyForText(
      'tenant-a', ai, 'oi, td bem?', 'Cliente', undefined, undefined,
      '595981234567', undefined, 'beauty_studio', MEDIA_CONFIG, undefined, undefined, undefined, 'fake-groq-key'
    );

    expect(getToolCalls()).toBe(0);
    expect(uploadWhatsAppMedia).not.toHaveBeenCalled();
  });

  it('cai pro Gemini quando o Groq devolve HTTP não-2xx', async () => {
    mockGroqFetch({ httpStatus: 500 });
    const { ai, getToolCalls } = fakeGemini();

    const result = await generateAutoReplyForText(
      'tenant-a', ai, 'tem foto?', 'Cliente', undefined, undefined,
      '595981234567', undefined, 'beauty_studio', MEDIA_CONFIG, undefined, undefined, undefined, 'fake-groq-key'
    );

    expect(result).not.toBeNull();
    expect(getToolCalls()).toBe(1);
    expect(uploadWhatsAppMedia).toHaveBeenCalled();
  });

  it('cai pro Gemini quando o Groq devolve JSON malformado', async () => {
    mockGroqFetch({ malformed: true });
    const { ai, getToolCalls } = fakeGemini();

    await generateAutoReplyForText(
      'tenant-a', ai, 'tem foto?', 'Cliente', undefined, undefined,
      '595981234567', undefined, 'beauty_studio', MEDIA_CONFIG, undefined, undefined, undefined, 'fake-groq-key'
    );

    expect(getToolCalls()).toBe(1);
  });

  it('cai pro Gemini quando o Groq devolve uma "action" fora do enum esperado', async () => {
    mockGroqFetch({ action: 'mandar_tudo' });
    const { ai, getToolCalls } = fakeGemini();

    await generateAutoReplyForText(
      'tenant-a', ai, 'tem foto?', 'Cliente', undefined, undefined,
      '595981234567', undefined, 'beauty_studio', MEDIA_CONFIG, undefined, undefined, undefined, 'fake-groq-key'
    );

    expect(getToolCalls()).toBe(1);
  });

  it('sem groqApiKey, nunca chama fetch — comportamento inalterado (só Gemini)', async () => {
    const fetchSpy = vi.fn();
    global.fetch = fetchSpy as any;
    const { ai, getToolCalls } = fakeGemini();

    await generateAutoReplyForText(
      'tenant-a', ai, 'tem foto?', 'Cliente', undefined, undefined,
      '595981234567', undefined, 'beauty_studio', MEDIA_CONFIG
    );

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(getToolCalls()).toBe(1);
  });
});
