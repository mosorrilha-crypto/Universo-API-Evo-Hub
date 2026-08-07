/**
 * Achado numa auditoria pós-lançamento: quando a chamada real ao Gemini
 * falhava (rate limit, timeout, JSON malformado), /api/analyze-conversation
 * caía num fallback que INVENTAVA dados de venda (orçamento, objeções,
 * "10% de desconto via PIX" — PIX nem existe no Paraguai) e uma resposta
 * pronta pra mandar direto no WhatsApp, sem nenhum aviso pro operador de
 * que não era uma análise real. Um lead real (595981828280) ativou esse
 * fallback e o painel mostrou o texto fabricado como se fosse análise de
 * IA de verdade — risco real de um operador mandar um desconto inventado
 * e sem autorização pra um cliente. Trava aqui que o fallback nunca inventa
 * números/promessas e sempre se identifica como indisponível.
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
    server = app.listen(0, resolve);
  });
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  baseUrl = `http://127.0.0.1:${port}`;
});

afterAll(() => {
  server.close();
});

describe('POST /api/analyze-conversation — fallback nunca inventa dados de venda', () => {
  it('não inventa orçamento/desconto/PIX quando o Gemini falha, e se identifica como fallback', async () => {
    const res = await fetch(`${baseUrl}/api/analyze-conversation`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        leadInfo: { name: 'Cliente Teste', phone: '595981828280' },
        messages: [{ sender: 'lead', text: 'Oi, quero saber mais' }],
      }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();

    expect(data.source).toBe('fallback');
    expect(data.analysis.suggestedSmartReply).toBe('');
    const serialized = JSON.stringify(data.analysis);
    expect(serialized).not.toMatch(/PIX/i);
    expect(serialized).not.toMatch(/desconto/i);
    expect(serialized).not.toContain('R$ 590');
    expect(data.analysis.extractedCRMData.productsOfInterest).toEqual([]);
    expect(data.analysis.extractedCRMData.keyObjections).toEqual([]);
  });
});
