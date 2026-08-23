/**
 * Achado ao investigar "o áudio sai mas não chega" ao vivo: o webhook da
 * Meta manda `value.statuses[]` pra reportar sent/delivered/read/failed de
 * mensagens QUE NÓS ENVIAMOS — só `value.messages[]` (mensagens recebidas)
 * era lido, então uma falha de entrega reportada pela própria Meta ficava
 * completamente invisível, mesmo com o upload/send original retornando 200
 * (esse 200 só confirma que entrou na fila da Meta, não que chegou de
 * verdade no destinatário). Trava que um status "failed" (ou qualquer
 * status com `errors`) sempre gera um log de aviso visível.
 */
import express from 'express';
import type { Server } from 'http';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createWebhooksRouter } from '../webhooks';

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

describe('POST /webhook — status de entrega (sent/delivered/read/failed) da Meta', () => {
  it('loga um aviso visível quando a Meta reporta status "failed" pra uma mensagem que enviamos', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      const res = await fetch(`${baseUrl}/webhook`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          object: 'whatsapp_business_account',
          entry: [{
            changes: [{
              value: {
                statuses: [{
                  id: 'wamid.TESTE123',
                  status: 'failed',
                  recipient_id: '595981111111',
                  errors: [{ code: 131053, title: 'Media upload error' }],
                }],
              },
            }],
          }],
        }),
      });
      expect(res.status).toBe(200);
      expect(warnSpy).toHaveBeenCalled();
      const loggedArgs = warnSpy.mock.calls.map((c) => c.join(' ')).join(' ');
      expect(loggedArgs).toContain('wamid.TESTE123');
      expect(loggedArgs).toContain('failed');
    } finally {
      warnSpy.mockRestore();
    }
  });

  it('não gera aviso pra status normais (sent/delivered/read) sem erro', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      const res = await fetch(`${baseUrl}/webhook`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          object: 'whatsapp_business_account',
          entry: [{
            changes: [{
              value: {
                statuses: [{ id: 'wamid.TESTE456', status: 'delivered', recipient_id: '595981111111' }],
              },
            }],
          }],
        }),
      });
      expect(res.status).toBe(200);
      expect(warnSpy).not.toHaveBeenCalled();
    } finally {
      warnSpy.mockRestore();
    }
  });
});
