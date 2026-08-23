/**
 * Achado numa auditoria externa: a checagem HMAC do webhook Meta só rodava
 * "se o header vier" (`if (signatureHeader && appSecret)`) — um POST sem
 * x-hub-signature-256 pulava a validação inteira e era processado como
 * legítimo, mesmo com META_APP_SECRET configurado (fail-open). Isso
 * permitia forjar mensagens de WhatsApp inteiras só omitindo o header.
 * Trava que, com o secret configurado, o header é sempre obrigatório
 * (fail-closed).
 */
import express from 'express';
import type { Server } from 'http';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createWebhooksRouter } from '../webhooks';

let server: Server;
let baseUrl: string;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use(createWebhooksRouter({ metaWebhookVerifyToken: 'verify-token', metaAppSecret: 'test-app-secret' }));

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

describe('Webhook Meta — validação fail-closed', () => {
  it('rejeita (403) uma inscrição sem token de verificação', async () => {
    const res = await fetch(`${baseUrl}/webhook?hub.mode=subscribe&hub.challenge=challenge`);
    expect(res.status).toBe(403);
  });

  it('aceita a inscrição somente com modo e token corretos', async () => {
    const res = await fetch(`${baseUrl}/webhook?hub.mode=subscribe&hub.verify_token=verify-token&hub.challenge=challenge`);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('challenge');
  });


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
