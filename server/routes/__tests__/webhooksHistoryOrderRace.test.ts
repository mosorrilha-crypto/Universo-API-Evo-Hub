/**
 * TASK-0172 — achado real em produção (Gladys, tenant Monique, 30/08/2026):
 * o histórico entregue ao autoReply era cortado por CONTAGEM
 * (`conversation.messages.slice(0, -historyExclude)`), supondo que nada
 * mais tinha sido gravado desde que o lote de mensagens deste ciclo foi
 * bufferizado. runExclusive (perPhoneQueue.ts) serializa os ciclos de
 * resposta por telefone, mas um ciclo pode ficar PRESO na fila enquanto o
 * cliente manda mais mensagens — que já são gravadas na hora
 * (recordIncomingMessage roda ANTES de qualquer buffer/fila). Quando isso
 * acontece, o corte por contagem pega o lote errado: inclui a própria
 * mensagem deste ciclo (duplicada com `text`) e perde uma mensagem nova
 * real. Corrigido cortando por IDENTIDADE (tudo antes do ID da primeira
 * mensagem do lote, ver messageBuffer.ts firstMessageId), robusto mesmo com
 * mensagens novas chegando enquanto o ciclo espera a vez.
 *
 * Este teste mocka só `getConversation` (o fake Supabase de teste não
 * suporta o embed `messages(...)` do Postgres real usado por essa query) —
 * tudo o resto (recordIncomingMessage, o buffer real de 10s, runExclusive
 * real, e a lógica de corte de webhooks.ts) roda de verdade via HTTP.
 */
import express from 'express';
import type { Server } from 'http';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const generateAutoReplyForText = vi.fn(async () => null);
vi.mock('../../services/autoReply', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../services/autoReply')>();
  return { ...actual, generateAutoReplyForText };
});

const getConversation = vi.fn();
vi.mock('../../services/conversationStore', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../services/conversationStore')>();
  return { ...actual, getConversation };
});

const { createWebhooksRouter } = await import('../webhooks');
const { initDb } = await import('../../services/db');
const { createFakeSupabase } = await import('../../services/__tests__/fakeSupabase');

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
  generateAutoReplyForText.mockResolvedValue(null);
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

describe('POST /webhook — histórico do autoReply não pode ser cortado por contagem quando o ciclo anterior demora', () => {
  it('usa o ID da primeira mensagem do lote pra cortar o histórico, mesmo com uma mensagem nova gravada nesse meio-tempo', async () => {
    vi.useFakeTimers();
    const phone = '595981234567';

    // Cycle A (msg-1): quando rodar, a "conversa" só tem a própria msg-1.
    getConversation.mockResolvedValueOnce({
      phone,
      messages: [{ id: 'msg-1', sender: 'lead', type: 'text', text: 'Me gusta sabes 🥰', timestamp: 'x' }],
      updatedAt: 'x',
      unreadCount: 0,
    } as any);

    await fetch(`${baseUrl}/webhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(metaTextPayload(phone, 'msg-1', 'Me gusta sabes 🥰')),
    });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(generateAutoReplyForText).toHaveBeenCalledTimes(1);

    // Cycle B (msg-2): por hipótese do achado real, quando ESTE ciclo
    // finalmente roda, uma 3ª mensagem (msg-3) já foi gravada — simula a
    // fila (runExclusive) atrasada o suficiente pra isso acontecer.
    getConversation.mockResolvedValueOnce({
      phone,
      messages: [
        { id: 'msg-1', sender: 'lead', type: 'text', text: 'Me gusta sabes 🥰', timestamp: 'x' },
        { id: 'msg-2', sender: 'lead', type: 'text', text: 'Va ser la primera vez 🙈', timestamp: 'x' },
        { id: 'msg-3', sender: 'lead', type: 'text', text: 'Así ese diseño me gusta 🥰', timestamp: 'x' },
      ],
      updatedAt: 'x',
      unreadCount: 0,
    } as any);

    await fetch(`${baseUrl}/webhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(metaTextPayload(phone, 'msg-2', 'Va ser la primera vez 🙈')),
    });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(generateAutoReplyForText).toHaveBeenCalledTimes(2);

    // O 6º argumento posicional de generateAutoReplyForText é `history`.
    const historyForCycleB = (generateAutoReplyForText.mock.calls[1] as any[])[5] as Array<{ id: string }>;
    // Correto: só o que veio ANTES do lote de B (msg-1) — nunca a própria
    // msg-2 (já vai em `text`) nem perde a msg-3 (já tinha acontecido).
    expect(historyForCycleB.map((m) => m.id)).toEqual(['msg-1']);
  });
});
