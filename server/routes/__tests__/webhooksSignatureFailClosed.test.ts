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

  /**
   * Incidente real em produção (25/08/2026): a checagem acima rodava
   * incondicionalmente pra TODAS as rotas de webhook, inclusive
   * /api/webhooks/evolution — mas a Evolution API nunca envia
   * x-hub-signature-256 (não é a Meta). Resultado: com META_APP_SECRET
   * configurada, 100% das mensagens de tenants na Evolution API foram
   * descartadas silenciosamente por ~62h (403 em toda entrega). Trava pra
   * este cenário nunca mais passar despercebido.
   */
  it('aceita (200) um payload da Evolution API em /api/webhooks/evolution mesmo sem x-hub-signature-256', async () => {
    const res = await fetch(`${baseUrl}/api/webhooks/evolution`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ event: 'CONNECTION_UPDATE', instance: 'tenant-teste', data: {} }),
    });
    expect(res.status).toBe(200);
  });

  it('continua exigindo (403) x-hub-signature-256 em /api/webhooks/meta mesmo com payload no formato Evolution', async () => {
    const res = await fetch(`${baseUrl}/api/webhooks/meta`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ event: 'CONNECTION_UPDATE', instance: 'tenant-teste', data: {} }),
    });
    expect(res.status).toBe(403);
  });
});
