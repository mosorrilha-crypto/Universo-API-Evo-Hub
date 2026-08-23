import express from 'express';
import type { Server } from 'http';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const { capturedPrompts } = vi.hoisted(() => ({ capturedPrompts: [] as string[] }));

vi.mock('../../gemini', () => ({
  getGeminiClient: () => ({
    models: {
      generateContent: async ({ contents }: { contents: string }) => {
        capturedPrompts.push(contents);
        return {
          text: JSON.stringify({
            leadStage: 'contato',
            dealProbability: 35,
            overallSentiment: 'Dúvida',
            urgencyLevel: 2,
            detectedLanguage: 'Espanhol (Paraguai)',
            conversationSummary: 'A cliente perguntou se há foto disponível.',
            extractedCRMData: { budget: '', timeline: '', productsOfInterest: ['Pestañas'], keyObjections: [], decisionCriteria: '' },
            keyTopicsDiscussed: ['foto'],
            multiModalInsights: [],
            actionObjective: 'Responder sobre a disponibilidade de foto.',
            actionRationale: 'A última mensagem pede uma foto.',
            actionGuardrail: 'Não afirmar que um arquivo foi enviado sem uma ação real de mídia.',
            recommendedNextAction: 'Confirmar a disponibilidade da mídia antes de oferecer outro próximo passo.',
            suggestedSmartReply: 'Vou confirmar qual foto posso te enviar por aqui.',
            suggestedSmartReplyTranslation: 'Vou confirmar qual foto posso te enviar por aqui.',
          }),
        };
      },
    },
  }),
  withGeminiRetry: async <T>(operation: () => Promise<T>) => operation(),
}));

const { createAiRouter } = await import('../ai');

let server: Server;
let baseUrl: string;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use(createAiRouter({
    config: { geminiApiKey: 'fake-key' } as any,
    authenticateToken: (_req, _res, next) => next(),
    rateLimiter: (_req, _res, next) => next(),
  }));
  await new Promise<void>((resolve) => { server = app.listen(0, () => resolve()); });
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  baseUrl = `http://127.0.0.1:${port}`;
});

afterAll(() => server.close());

describe('POST /api/analyze-conversation — prioridade de pedido de mídia', () => {
  it('instrui o modelo a responder pedido de foto antes de desviar para catálogo ou agenda', async () => {
    capturedPrompts.length = 0;
    const response = await fetch(`${baseUrl}/api/analyze-conversation`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        leadInfo: { name: 'Lucas', phone: '595980000000' },
        messages: [
          { sender: 'agent', text: 'Por el momento no tengo ese material disponible para enviarte por acá.' },
          { sender: 'lead', text: 'Tiene foto de las pestañas?' },
        ],
      }),
    });

    expect(response.status).toBe(200);
    expect(capturedPrompts).toHaveLength(1);
    const prompt = capturedPrompts[0];
    expect(prompt).toContain('REGRA INEGOCIÁVEL DE PRIORIDADE');
    expect(prompt).toContain('PEDIDOS DE FOTO, VÍDEO, CATÁLOGO OU OUTRA MÍDIA');
    expect(prompt).toContain('Nunca substitua uma pergunta específica por lista de serviços');
    expect(prompt).toContain('Tiene foto de las pestañas?');
  });
});
