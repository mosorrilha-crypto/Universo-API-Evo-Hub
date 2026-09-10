/**
 * TASK-0350 — achado real em produção durante o incidente ativo de créditos
 * Gemini esgotados: um operador viu "Não foi possível gerar a resposta agora
 * (Gemini indisponível)" na Ficha IA porque o Groq TAMBÉM tinha falhado
 * pouco antes com "Groq respondeu 400: json_validate_failed" — os 4
 * endpoints deste roteador usavam o modelo default de callGroqJsonCompletion
 * (openai/gpt-oss-20b, dimensionado só pro roteador do autoReply.ts, uma
 * classificação curta) pra gerar JSON bem mais complexo. Este teste garante
 * que os 4 endpoints agora pedem ao Groq o mesmo modelo mais forte já usado
 * pra resposta do especialista (TASK-0346, llama-3.3-70b-versatile) —
 * reduzindo a chance de falha de validação de JSON na 1ª tentativa.
 */
import express from 'express';
import type { Server } from 'http';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { GROQ_SPECIALIST_MODEL } from '../../services/groqClient';

const { createAiRouter } = await import('../ai');

let server: Server;
let baseUrl: string;
const originalFetch = global.fetch;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use(
    createAiRouter({
      config: { geminiApiKey: 'fake-key', groqApiKey: 'fake-groq-key' } as any,
      authenticateToken: (_req, _res, next) => next(),
      rateLimiter: (_req, _res, next) => next(),
    })
  );
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => resolve());
  });
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  baseUrl = `http://127.0.0.1:${port}`;
});

afterAll(() => {
  server.close();
});

afterEach(() => {
  global.fetch = originalFetch;
});

// O próprio teste fala HTTP com o servidor Express local via `fetch` — como
// isso usa o mesmo `global.fetch` que o groqClient.ts chama internamente,
// o mock precisa distinguir pela URL e deixar a chamada de teste passar
// direto (senão ela nunca chega no endpoint de verdade).
function mockGroqFetch(responseBody: unknown) {
  let lastModel: string | undefined;
  global.fetch = vi.fn(async (url: any, init?: any) => {
    if (typeof url !== 'string' || !url.includes('api.groq.com')) {
      return originalFetch(url, init);
    }
    const body = JSON.parse(init.body);
    lastModel = body.model;
    return {
      ok: true,
      status: 200,
      json: async () => ({ choices: [{ message: { content: JSON.stringify(responseBody) } }] }),
    } as Response;
  });
  return () => lastModel;
}

describe('endpoints da Ficha IA pedem o modelo Groq mais forte (TASK-0350)', () => {
  it('POST /api/ai/reply-from-hint usa GROQ_SPECIALIST_MODEL', async () => {
    const getLastModel = mockGroqFetch({ reply: 'ok', detectedLanguage: 'Português', translation: '' });

    await fetch(`${baseUrl}/api/ai/reply-from-hint`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ leadInfo: {}, messages: [], hint: 'diz oi' }),
    });

    expect(getLastModel()).toBe(GROQ_SPECIALIST_MODEL);
  });

  it('POST /api/ai/ask usa GROQ_SPECIALIST_MODEL', async () => {
    const getLastModel = mockGroqFetch({ answer: 'ok' });

    await fetch(`${baseUrl}/api/ai/ask`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ leadInfo: {}, messages: [], question: 'qualquer coisa' }),
    });

    expect(getLastModel()).toBe(GROQ_SPECIALIST_MODEL);
  });

  it('POST /api/analyze-conversation usa GROQ_SPECIALIST_MODEL', async () => {
    const getLastModel = mockGroqFetch({ leadStage: 'contato' });

    await fetch(`${baseUrl}/api/analyze-conversation`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ leadInfo: {}, messages: [], agentKnowledgeBase: null }),
    });

    expect(getLastModel()).toBe(GROQ_SPECIALIST_MODEL);
  });

  it('POST /api/analytics/ai-report usa GROQ_SPECIALIST_MODEL', async () => {
    const getLastModel = mockGroqFetch({ report: 'ok' });

    await fetch(`${baseUrl}/api/analytics/ai-report`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ leads: [] }),
    });

    expect(getLastModel()).toBe(GROQ_SPECIALIST_MODEL);
  });
});
