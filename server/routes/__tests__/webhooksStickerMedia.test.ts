/**
 * Achado real (pedido direto: "ajusta pra abrir figurinhas") — sticker
 * chegava só como texto "🏷️ Figurinha recebida" (tipo 'other' genérico,
 * sem baixar a mídia), então o operador nunca via a figurinha de verdade.
 * Agora vira type:'image' (reaproveita o mesmo player de foto do painel,
 * já que o MessageType só tem text/audio/image/file) com a mídia baixada e
 * salva sob o messageId — mesma mecânica de download já usada pra foto,
 * ver webhooks.ts.
 */
import express from 'express';
import type { Server } from 'http';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createWebhooksRouter } from '../webhooks';
import { initDb } from '../../services/db';
import { createFakeSupabase } from '../../services/__tests__/fakeSupabase';

const INSTANCE_NAME = 'test-instance';

let server: Server;
let baseUrl: string;
let supabase: ReturnType<typeof createFakeSupabase>;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use(createWebhooksRouter({
    metaWebhookVerifyToken: 'verify-token',
    evolutionInstanceName: INSTANCE_NAME,
    evolutionApiUrl: 'https://fake-evolution.test',
    evolutionApiKey: 'fake-key',
  }));

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
  supabase = createFakeSupabase();
  initDb(supabase);
});

function evolutionInboundPayload(overrides: { messageId: string; remoteJid: string; message: any }) {
  return {
    event: 'messages.upsert',
    instance: INSTANCE_NAME,
    data: {
      key: { id: overrides.messageId, remoteJid: overrides.remoteJid, fromMe: false },
      pushName: 'Jenny',
      message: overrides.message,
    },
  };
}

describe('webhook — figurinha (sticker) vira mensagem de imagem, não texto genérico', () => {
  it('sticker recebido do cliente grava type:image com rótulo de figurinha, sob o messageId real', async () => {
    const res = await fetch(`${baseUrl}/webhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(evolutionInboundPayload({
        messageId: 'wamid-sticker-1',
        remoteJid: '595981234567@s.whatsapp.net',
        message: { stickerMessage: { mimetype: 'image/webp' } },
      })),
    });
    expect(res.status).toBe(200);

    const rows = supabase.__tables.messages || [];
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: 'wamid-sticker-1', sender: 'lead', type: 'image' });
    expect(String(rows[0].text)).toContain('Figurinha');
  });

  it('sticker nunca dispara escalonamento de comprovante de pagamento (isso é só pra foto)', async () => {
    const res = await fetch(`${baseUrl}/webhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(evolutionInboundPayload({
        messageId: 'wamid-sticker-2',
        remoteJid: '595981234567@s.whatsapp.net',
        message: { stickerMessage: { mimetype: 'image/webp' } },
      })),
    });
    expect(res.status).toBe(200);
    expect(supabase.__tables.escalations || []).toHaveLength(0);
  });
});
