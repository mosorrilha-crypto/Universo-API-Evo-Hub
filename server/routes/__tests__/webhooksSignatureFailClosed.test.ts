/**
 * Achado numa auditoria externa: a checagem HMAC do webhook Meta só rodava
 * "se o header vier" (`if (signatureHeader && appSecret)`) — um POST sem
 * x-hub-signature-256 pulava a validação inteira e era processado como
 * legítimo, mesmo com META_APP_SECRET configurado (fail-open). Isso
 * permitia forjar mensagens de WhatsApp inteiras só omitindo o header.
 * Trava que, com o secret configurado, o header é sempre obrigatório
 * (fail-closed) — mesmo padrão que handleEvoHubWebhook já usava.
 */
import express from 'express';
import type { Server } from 'http';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createWebhooksRouter } from '../webhooks';

let server: Server;
let baseUrl: string;
const ORIGINAL_APP_SECRET = process.env.META_APP_SECRET;

beforeAll(async () => {
  process.env.META_APP_SECRET = 'test-app-secret';

  const app = express();
  app.use(express.json());
  app.use(createWebhooksRouter({ metaWebhookVerifyToken: 'verify-token' }));

  await new Promise<void>((resolve) => {
    server = app.listen(0, resolve);
  });
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  baseUrl = `http://127.0.0.1:${port}`;
});

afterAll(() => {
  server.close();
  process.env.META_APP_SECRET = ORIGINAL_APP_SECRET;
});

describe('POST /webhook — assinatura HMAC fail-closed', () => {
  it('rejeita (403) um payload sem x-hub-signature-256 quando o app secret está configurado', async () => {
    const res = await fetch(`${baseUrl}/webhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // Sem nenhum header de assinatura — antes da correção, isso passava direto.
      body: JSON.stringify({ object: 'whatsapp_business_account', entry: [] }),
    });
    expect(res.status).toBe(403);
  });

  it('rejeita (403) uma assinatura inválida', async () => {
    const res = await fetch(`${baseUrl}/webhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-hub-signature-256': 'sha256=assinatura-forjada' },
      body: JSON.stringify({ object: 'whatsapp_business_account', entry: [] }),
    });
    expect(res.status).toBe(403);
  });
});
