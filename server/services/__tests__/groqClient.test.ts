/**
 * Router fallback Groq (plano aprovado) — cliente REST mínimo, sem SDK.
 * Cobre só o contrato do módulo (sucesso, HTTP não-2xx, conteúdo ausente,
 * JSON malformado, timeout) — quem decide "cai pro Gemini" é o chamador
 * (classifyAgent em autoReply.ts, testado separadamente).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { callGroqJsonCompletion } from '../groqClient';

const originalFetch = global.fetch;

afterEach(() => {
  global.fetch = originalFetch;
  vi.useRealTimers();
});

function mockFetchOnce(response: Partial<Response> & { json?: () => Promise<any>; text?: () => Promise<string> }) {
  global.fetch = vi.fn(async () => response as Response);
}

describe('callGroqJsonCompletion', () => {
  it('parseia o conteúdo JSON e devolve usage mapeado de prompt/completion/total tokens', async () => {
    mockFetchOnce({
      ok: true,
      status: 200,
      json: async () => ({
        choices: [{ message: { content: JSON.stringify({ agent: 'faq', confidence: 0.9 }) } }],
        usage: { prompt_tokens: 50, completion_tokens: 10, total_tokens: 60 },
      }),
    });

    const result = await callGroqJsonCompletion('fake-key', 'classifique isso');

    expect(result.parsed).toEqual({ agent: 'faq', confidence: 0.9 });
    expect(result.usage).toEqual({ promptTokenCount: 50, candidatesTokenCount: 10, totalTokenCount: 60 });
  });

  it('lança quando o HTTP não é 2xx', async () => {
    mockFetchOnce({ ok: false, status: 429, text: async () => 'rate limited' });
    await expect(callGroqJsonCompletion('fake-key', 'prompt')).rejects.toThrow(/429/);
  });

  it('lança quando não há choices[0].message.content', async () => {
    mockFetchOnce({ ok: true, status: 200, json: async () => ({ choices: [] }) });
    await expect(callGroqJsonCompletion('fake-key', 'prompt')).rejects.toThrow(/conteúdo/);
  });

  it('lança quando o content não é JSON válido', async () => {
    mockFetchOnce({ ok: true, status: 200, json: async () => ({ choices: [{ message: { content: 'não é json' } }] }) });
    await expect(callGroqJsonCompletion('fake-key', 'prompt')).rejects.toThrow(/JSON válido/);
  });

  it('lança quando o fetch estoura o timeout (AbortError)', async () => {
    global.fetch = vi.fn(
      (_url: any, init: any) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
        })
    ) as any;

    await expect(callGroqJsonCompletion('fake-key', 'prompt', 20)).rejects.toThrow();
  });
});
