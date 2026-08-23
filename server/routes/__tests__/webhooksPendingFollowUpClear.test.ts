/**
 * Acompanhamento de funil (pedido real, 15/08/2026) — quando o cliente
 * responde de novo (qualquer mensagem real, não eco), a pendência
 * 'customer_reply' (esperando ele escolher/confirmar algo) deixa de fazer
 * sentido e precisa ser cancelada. Testa só essa ponta de fiação
 * (webhooks.ts chama clearPendingFollowUp na hora certa, com os argumentos
 * certos) — a lógica de idempotência/job já está coberta em
 * pendingFollowUpJob.test.ts.
 */
import express from 'express';
import type { Server } from 'http';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const clearPendingFollowUp = vi.fn(async (..._args: any[]) => undefined);
const markPendingFollowUp = vi.fn(async (..._args: any[]) => undefined);

vi.mock('../../services/pendingFollowUpStore', () => ({ clearPendingFollowUp, markPendingFollowUp }));

const { createWebhooksRouter } = await import('../webhooks');
const { initDb } = await import('../../services/db');
const { createFakeSupabase } = await import('../../services/__tests__/fakeSupabase');

let server: Server;
let baseUrl: string;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use(createWebhooksRouter({ metaWebhookVerifyToken: 'verify-token' }));
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
});

function metaTextPayload(from: string, messageId: string, text: string) {
  return {
    object: 'whatsapp_business_account',
    entry: [
      {
        changes: [
          {
            value: {
              metadata: {},
              messages: [{ id: messageId, from, type: 'text', text: { body: text } }],
            },
          },
        ],
      },
    ],
  };
}

describe('POST /webhook — cancela pendência "customer_reply" quando o cliente responde de novo', () => {
  it('mensagem de texto real do lead cancela pendência do mesmo telefone', async () => {
    const res = await fetch(`${baseUrl}/webhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(metaTextPayload('595981234567', 'wamid-1', 'Sábado às 14h está ótimo!')),
    });
    expect(res.status).toBe(200);

    expect(clearPendingFollowUp).toHaveBeenCalledWith(expect.any(String), '595981234567', 'customer_reply');
  });
});
