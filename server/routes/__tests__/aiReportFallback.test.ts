/**
 * Mesma classe de bug já corrigida em /api/analyze-conversation: quando o
 * Gemini falhava, /api/analytics/ai-report caía num fallback que inventava
 * métricas de negócio inteiras (68% dos leads via Meta Ads, CAC R$ 22,40,
 * ROAS 4.8x, Match Quality Score 8.9/10) e uma recomendação de aumentar
 * orçamento em 25% — apresentado como relatório real da "IA Universo", sem
 * nenhum aviso de que era fabricado. Trava que o fallback nunca inventa
 * números de negócio.
 */
import express from 'express';
import type { Server } from 'http';
import { describe, expect, it, vi, beforeAll, afterAll } from 'vitest';

vi.mock('../../gemini', () => ({
  getGeminiClient: () => ({
    models: {
      generateContent: async () => {
        throw new Error('Gemini indisponível (simulado no teste)');
      },
    },
  }),
}));

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

describe('POST /api/analytics/ai-report — fallback nunca inventa métricas de negócio', () => {
  it('não inventa ROAS/CAC/Match Quality Score quando o Gemini falha, e se identifica como fallback', async () => {
    const res = await fetch(`${baseUrl}/api/analytics/ai-report`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ leads: [] }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();

    expect(data.source).toBe('fallback');
    expect(data.report).not.toMatch(/68%/);
    expect(data.report).not.toMatch(/ROAS/i);
    expect(data.report).not.toMatch(/R\$ 22,40/);
    expect(data.report).not.toMatch(/8\.9\/10/);
    expect(data.report).not.toMatch(/aumentar em 25%/i);
  });
});
