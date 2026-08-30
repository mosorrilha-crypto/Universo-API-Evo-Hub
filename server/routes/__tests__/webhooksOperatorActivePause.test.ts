/**
 * TASK-0177 — achado real (pedido do dono do produto, 30/08/2026): quando o
 * operador está respondendo manualmente AO VIVO num contato pessoal que às
 * vezes também é cliente, a IA continuava disparando resposta automática pra
 * cada mensagem nova — cruzando com a resposta do operador na mesma janela
 * de segundos, revelando na hora que tem um bot no meio (reproduzido tanto
 * num teste quanto observado numa conversa real). Se o operador mandou uma
 * mensagem manual pra este número recentemente, a IA cede a vez.
 *
 * Mocka `getConversation` (o fake Supabase de teste não suporta o embed
 * `messages(...)` do Postgres real) — tudo o resto roda de verdade via HTTP.
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

describe('POST /webhook — IA cede a vez quando o operador respondeu manualmente há pouco', () => {
  it('não gera resposta automática quando o operador mandou mensagem manual há menos de 5min', async () => {
    vi.useFakeTimers();
    const phone = '5567999249351';

    getConversation.mockResolvedValueOnce({
      phone,
      messages: [
        { id: 'm-1', sender: 'lead', type: 'text', text: 'oi', timestamp: new Date(Date.now() - 60_000).toISOString() },
        { id: 'm-2', sender: 'agent', sentBy: 'operator', type: 'text', text: 'kkkk vamos sin', timestamp: new Date(Date.now() - 30_000).toISOString() },
      ],
      updatedAt: 'x',
      unreadCount: 0,
    } as any);

    await fetch(`${baseUrl}/webhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(metaTextPayload(phone, 'msg-1', 'Onde é?')),
    });
    await vi.advanceTimersByTimeAsync(10_000);

    expect(generateAutoReplyForText).not.toHaveBeenCalled();
  });

  it('gera resposta automática normalmente quando a última mensagem do operador é antiga (mais de 5min)', async () => {
    vi.useFakeTimers();
    const phone = '5567999249352';

    getConversation.mockResolvedValueOnce({
      phone,
      messages: [
        { id: 'm-0', sender: 'lead', type: 'text', text: 'oi, vi o anúncio', timestamp: new Date(Date.now() - 2 * 60 * 60_000).toISOString() },
        { id: 'm-1', sender: 'agent', sentBy: 'operator', type: 'text', text: 'Foi resolvido ontem', timestamp: new Date(Date.now() - 60 * 60_000).toISOString() },
      ],
      updatedAt: 'x',
      unreadCount: 0,
    } as any);

    await fetch(`${baseUrl}/webhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(metaTextPayload(phone, 'msg-2', 'Quiero agendar')),
    });
    await vi.advanceTimersByTimeAsync(10_000);

    expect(generateAutoReplyForText).toHaveBeenCalledTimes(1);
  });

  it('gera resposta automática normalmente quando a última mensagem do agente foi da própria IA, não do operador', async () => {
    vi.useFakeTimers();
    const phone = '5567999249353';

    getConversation.mockResolvedValueOnce({
      phone,
      messages: [
        { id: 'm-1', sender: 'agent', sentBy: 'ai', type: 'text', text: 'Tenemos disponible el lunes', timestamp: new Date(Date.now() - 10_000).toISOString() },
      ],
      updatedAt: 'x',
      unreadCount: 0,
    } as any);

    await fetch(`${baseUrl}/webhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(metaTextPayload(phone, 'msg-3', 'Perfecto, el lunes entonces')),
    });
    await vi.advanceTimersByTimeAsync(10_000);

    expect(generateAutoReplyForText).toHaveBeenCalledTimes(1);
  });
});
