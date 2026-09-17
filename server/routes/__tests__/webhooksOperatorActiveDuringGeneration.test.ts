/**
 * TASK-0428 — achado real (tenant Monique, cliente "Ninfa Oviedo", print/
 * histórico confirmado): a checagem de "operador respondeu manualmente há
 * pouco, a IA cede a vez" (TASK-0177/0181) só rodava UMA vez, com um
 * snapshot da conversa capturado ANTES de chamar o Gemini. Na conversa real,
 * a operadora respondeu ao vivo ("Holaaa ✨", "Buen día ☀️") bem no meio da
 * janela em que a resposta automática já estava sendo gerada (Gemini +
 * digitação simulada, alguns segundos) — a checagem inicial não via essa
 * mensagem ainda (ela não existia no snapshot), passava, e a resposta da IA
 * saía de qualquer jeito quando a geração terminava, cruzando por cima do
 * que a operadora já tinha respondido. A própria operadora chegou a se
 * desculpar na conversa real: "Holaaa, perdón — Te contestó el assistente."
 *
 * Este teste reproduz a corrida: a 1ª checagem (snapshot antes de gerar) não
 * tem mensagem recente do operador e passa; a 2ª checagem (snapshot novo,
 * logo antes do envio) já tem — a resposta da IA nunca deve chegar a ser
 * enviada.
 */
import express from 'express';
import type { Server } from 'http';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const generateAutoReplyForText = vi.fn();
vi.mock('../../services/autoReply', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../services/autoReply')>();
  return { ...actual, generateAutoReplyForText };
});

const getConversation = vi.fn();
vi.mock('../../services/conversationStore', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../services/conversationStore')>();
  return { ...actual, getConversation };
});

const reviewAutoReplyBeforeSend = vi.fn(async () => ({ approved: true, source: 'rules' as const, severity: 'low' as const, reason: 'ok' }));
vi.mock('../../services/replySafetyGate', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../services/replySafetyGate')>();
  return { ...actual, reviewAutoReplyBeforeSend };
});

const sendBubbles = vi.fn(async (_channel: any, _phone: string, bubbles: string[], onBubbleSent: (text: string) => Promise<void>) => {
  for (const bubble of bubbles) await onBubbleSent(bubble);
});
vi.mock('../../services/sendBubbles', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../services/sendBubbles')>();
  return { ...actual, sendBubbles };
});

const { createWebhooksRouter } = await import('../webhooks');
const { initDb } = await import('../../services/db');
const { createFakeSupabase } = await import('../../services/__tests__/fakeSupabase');

function draftResult(bubbles: string[]) {
  return {
    phase: 'abertura' as const,
    bubbles,
    agent: 'triagem' as const,
    needsHumanConfirmation: false,
    stopAutoReply: false,
    routerElapsedMs: 0,
  };
}

let server: Server;
let baseUrl: string;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use(createWebhooksRouter({ metaWebhookVerifyToken: 'verify-token', getAi: () => ({} as any) }));
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

beforeEach(() => {
  initDb(createFakeSupabase());
  vi.clearAllMocks();
  // `clearAllMocks` não esvazia a fila de `mockResolvedValueOnce` — um teste
  // que consome menos chamadas do que enfileirou vazaria valor pro próximo.
  // `mockReset` garante que cada teste começa com a fila realmente vazia.
  getConversation.mockReset();
  generateAutoReplyForText.mockReset();
  reviewAutoReplyBeforeSend.mockResolvedValue({ approved: true, source: 'rules', severity: 'low', reason: 'ok' });
});

afterEach(() => {
  vi.useRealTimers();
});

function metaTextPayload(from: string, messageId: string, text: string) {
  return {
    object: 'whatsapp_business_account',
    entry: [{ changes: [{ value: { metadata: {}, messages: [{ id: messageId, from, type: 'text', text: { body: text } }] } }] }],
  };
}

describe('POST /webhook — operadora responde ao vivo durante a geração da resposta (TASK-0428)', () => {
  it('nunca envia a resposta da IA quando o operador respondeu manualmente enquanto ela ainda estava sendo gerada', async () => {
    vi.useFakeTimers();
    const phone = '595981615225';

    // 1ª chamada (checagem no início, antes de gerar): sem mensagem recente
    // do operador — o gate inicial passa normalmente.
    getConversation.mockResolvedValueOnce({
      phone,
      messages: [{ id: 'm-1', sender: 'lead', type: 'text', text: 'Hola', timestamp: new Date(Date.now() - 60_000).toISOString() }],
      updatedAt: 'x',
      unreadCount: 0,
    } as any);
    // 2ª chamada (rechecagem, logo antes do envio): a operadora já respondeu
    // ao vivo NESSE meio-tempo (achado real — "Holaaa ✨"/"Buen día ☀️").
    getConversation.mockResolvedValueOnce({
      phone,
      messages: [
        { id: 'm-1', sender: 'lead', type: 'text', text: 'Hola', timestamp: new Date(Date.now() - 60_000).toISOString() },
        { id: 'm-2', sender: 'agent', sentBy: 'operator', type: 'text', text: 'Holaaa ✨', timestamp: new Date().toISOString() },
      ],
      updatedAt: 'x',
      unreadCount: 0,
    } as any);

    generateAutoReplyForText.mockResolvedValue(draftResult(['Hola, todo bien? Soy Ana, la asistente de Monique']));

    await fetch(`${baseUrl}/webhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(metaTextPayload(phone, 'msg-1', 'Hola')),
    });
    await vi.advanceTimersByTimeAsync(10_000);

    expect(generateAutoReplyForText).toHaveBeenCalledTimes(1);
    expect(getConversation).toHaveBeenCalledTimes(2);
    expect(sendBubbles).not.toHaveBeenCalled();
  });

  it('envia normalmente quando nenhuma mensagem nova do operador chegou durante a geração (sem regressão)', async () => {
    vi.useFakeTimers();
    const phone = '595981615226';

    const snapshot = {
      phone,
      messages: [{ id: 'm-1', sender: 'lead', type: 'text', text: 'Hola', timestamp: new Date(Date.now() - 60_000).toISOString() }],
      updatedAt: 'x',
      unreadCount: 0,
    };
    getConversation.mockResolvedValueOnce(snapshot as any);
    getConversation.mockResolvedValueOnce(snapshot as any);

    generateAutoReplyForText.mockResolvedValue(draftResult(['Hola, todo bien? Soy Ana, la asistente de Monique']));

    await fetch(`${baseUrl}/webhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(metaTextPayload(phone, 'msg-2', 'Hola')),
    });
    await vi.advanceTimersByTimeAsync(10_000);

    expect(generateAutoReplyForText).toHaveBeenCalledTimes(1);
    expect(sendBubbles).toHaveBeenCalledTimes(1);
  });
});
