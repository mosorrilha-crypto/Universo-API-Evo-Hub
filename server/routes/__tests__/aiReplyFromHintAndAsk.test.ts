/**
 * Ficha IA — dois pedidos reais (15/08/2026):
 * 1. POST /api/ai/reply-from-hint: operador escreve uma instrução curta e a
 *    IA devolve uma mensagem pronta seguindo ela (não inventa nada quando o
 *    Gemini falha — mesma política anti-fabricação do /api/analyze-conversation).
 * 2. POST /api/ai/ask: assistente de perguntas livres (sobre a conversa ou gerais).
 */
import express from 'express';
import type { Server } from 'http';
import { describe, expect, it, vi, beforeAll, afterAll } from 'vitest';

const { callCounter, mockResponse } = vi.hoisted(() => ({
  callCounter: { count: 0 },
  mockResponse: { text: '{}', shouldFail: false },
}));

vi.mock('../../gemini', async () => {
  const actual = await vi.importActual<typeof import('../../gemini')>('../../gemini');
  return {
    ...actual,
    getGeminiClient: () => ({
      models: {
        generateContent: async () => {
          callCounter.count += 1;
          if (mockResponse.shouldFail) throw new Error('Gemini indisponível (simulado no teste)');
          return { text: mockResponse.text };
        },
      },
    }),
  };
});

const { createAiRouter } = await import('../ai');

let server: Server;
let baseUrl: string;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use(
    createAiRouter({
      config: { geminiApiKey: 'fake-key' } as any,
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

describe('POST /api/ai/reply-from-hint', () => {
  it('400 quando "hint" está ausente ou vazio', async () => {
    const res = await fetch(`${baseUrl}/api/ai/reply-from-hint`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ leadInfo: {}, messages: [] }),
    });
    expect(res.status).toBe(400);
  });

  it('devolve a resposta gerada pelo Gemini quando disponível', async () => {
    mockResponse.shouldFail = false;
    mockResponse.text = JSON.stringify({
      reply: 'Sábado às 14h ainda está livre!',
      detectedLanguage: 'Português',
      translation: '',
    });

    const res = await fetch(`${baseUrl}/api/ai/reply-from-hint`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        leadInfo: { name: 'Cliente Teste', phone: '595981828280' },
        messages: [{ sender: 'lead', text: 'Ainda tem sábado?' }],
        hint: 'diz que sábado 14h ainda tá livre',
      }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.success).toBe(true);
    expect(data.source).toBe('gemini');
    expect(data.reply).toBe('Sábado às 14h ainda está livre!');
  });

  it('nunca inventa uma resposta quando o Gemini falha — source fallback, reply vazio', async () => {
    mockResponse.shouldFail = true;

    const res = await fetch(`${baseUrl}/api/ai/reply-from-hint`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        leadInfo: { name: 'Cliente Teste', phone: '595981828280' },
        messages: [],
        hint: 'diz que sábado 14h ainda tá livre',
      }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.source).toBe('fallback');
    expect(data.reply).toBe('');
    expect(data.error).toBeTruthy();
  });
});

describe('POST /api/ai/ask', () => {
  it('400 quando "question" está ausente ou vazia', async () => {
    const res = await fetch(`${baseUrl}/api/ai/ask`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ leadInfo: {}, messages: [] }),
    });
    expect(res.status).toBe(400);
  });

  it('devolve a resposta do Gemini pra pergunta sobre a conversa', async () => {
    mockResponse.shouldFail = false;
    mockResponse.text = JSON.stringify({ answer: 'Sim, o cliente mencionou orçamento de Gs 5.000.000 antes.' });

    const res = await fetch(`${baseUrl}/api/ai/ask`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        leadInfo: { name: 'Cliente Teste', phone: '595981828280' },
        messages: [{ sender: 'lead', text: 'Meu orçamento é Gs 5.000.000' }],
        question: 'esse cliente já falou de orçamento antes?',
      }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.success).toBe(true);
    expect(data.answer).toContain('5.000.000');
  });

  it('devolve a resposta do Gemini pra pergunta geral sem relação com o lead', async () => {
    mockResponse.shouldFail = false;
    mockResponse.text = JSON.stringify({ answer: '"Hola" em espanhol significa "olá".' });

    const res = await fetch(`${baseUrl}/api/ai/ask`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        leadInfo: {},
        messages: [],
        question: 'o que significa "hola" em espanhol?',
      }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.answer).toContain('olá');
  });

  it('nunca inventa uma resposta quando o Gemini falha — source fallback, answer vazio', async () => {
    mockResponse.shouldFail = true;

    const res = await fetch(`${baseUrl}/api/ai/ask`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ leadInfo: {}, messages: [], question: 'qualquer pergunta' }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.source).toBe('fallback');
    expect(data.answer).toBe('');
    expect(data.error).toBeTruthy();
  });
});
