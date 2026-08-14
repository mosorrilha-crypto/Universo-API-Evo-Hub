/**
 * Achado ao vivo em produção: mensagem (texto, áudio ou imagem) mandada
 * direto do celular conectado via Evolution API — fora do nosso painel/IA —
 * ficava invisível pro operador E pro contexto futuro do agente. A Evolution
 * API espelha TODA atividade do número, inclusive nosso próprio envio via
 * API (evento fromMe:true) — sem distinguir isso, ou duplicamos toda
 * mensagem que já mandamos, ou ignoramos pra sempre o que foi mandado
 * direto do celular. Cobre os dois lados: eco de envio nosso é descartado
 * (não duplica); mensagem sem eco esperado vira registro novo (sentBy=
 * 'operator'). Ver server/services/outboundEchoTracker.ts.
 */
import express from 'express';
import type { Server } from 'http';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createWebhooksRouter } from '../webhooks';
import { initDb } from '../../services/db';
import { createFakeSupabase } from '../../services/__tests__/fakeSupabase';
import { registerPendingEcho } from '../../services/outboundEchoTracker';

const TENANT_A = '11111111-1111-1111-1111-111111111111'; // LEGACY_DEFAULT_TENANT_ID
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
    server = app.listen(0, resolve);
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

function evolutionFromMePayload(overrides: { messageId: string; remoteJid: string; message: any }) {
  return {
    event: 'messages.upsert',
    instance: INSTANCE_NAME,
    data: {
      key: { id: overrides.messageId, remoteJid: overrides.remoteJid, fromMe: true },
      pushName: 'Monique',
      message: overrides.message,
    },
  };
}

describe('webhook fromMe:true — eco de envio (Evolution API)', () => {
  it('eco de mensagem de texto que JÁ mandamos pelo painel é descartado, não duplica', async () => {
    await registerPendingEcho(TENANT_A, '595981234567', 'text', 'Súper! Mañana podría?');

    const res = await fetch(`${baseUrl}/webhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(evolutionFromMePayload({
        messageId: 'wamid-echo-1',
        remoteJid: '595981234567@s.whatsapp.net',
        message: { conversation: 'Súper! Mañana podría?' },
      })),
    });
    expect(res.status).toBe(200);

    expect(supabase.__tables.messages || []).toHaveLength(0);
    expect(supabase.__tables.pending_outbound_echoes || []).toHaveLength(0);
  });

  it('mensagem de texto mandada direto do celular (sem eco pendente) vira mensagem nova sentBy=operator', async () => {
    const res = await fetch(`${baseUrl}/webhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(evolutionFromMePayload({
        messageId: 'wamid-direct-1',
        remoteJid: '595981234567@s.whatsapp.net',
        message: { conversation: 'Súper! Mañana podría?' },
      })),
    });
    expect(res.status).toBe(200);

    const rows = supabase.__tables.messages || [];
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ sender: 'agent', sent_by: 'operator', type: 'text', text: 'Súper! Mañana podría?' });
  });

  it('imagem mandada direto do celular (sem eco pendente) vira mensagem nova sentBy=operator', async () => {
    const res = await fetch(`${baseUrl}/webhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(evolutionFromMePayload({
        messageId: 'wamid-direct-img-1',
        remoteJid: '595981234567@s.whatsapp.net',
        message: { imageMessage: {} },
      })),
    });
    expect(res.status).toBe(200);

    const rows = supabase.__tables.messages || [];
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ sender: 'agent', sent_by: 'operator', type: 'image' });
  });

  it('eco de imagem que JÁ mandamos pelo painel é descartado, não duplica', async () => {
    await registerPendingEcho(TENANT_A, '595981234567', 'image');

    const res = await fetch(`${baseUrl}/webhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(evolutionFromMePayload({
        messageId: 'wamid-echo-img-1',
        remoteJid: '595981234567@s.whatsapp.net',
        message: { imageMessage: {} },
      })),
    });
    expect(res.status).toBe(200);
    expect(supabase.__tables.messages || []).toHaveLength(0);
  });

  it('nunca dispara resposta automática nem gera escalonamento pra mensagem fromMe', async () => {
    const res = await fetch(`${baseUrl}/webhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(evolutionFromMePayload({
        messageId: 'wamid-direct-2',
        remoteJid: '595981234567@s.whatsapp.net',
        message: { conversation: 'transferi o comprovante' },
      })),
    });
    expect(res.status).toBe(200);
    expect(supabase.__tables.escalations || []).toHaveLength(0);
  });
});
