/**
 * Instagram DM (Fase 1, 15/08/2026) — dispatch de webhook object === 'instagram'
 * dentro do handler genérico já usado por Evolution/Meta (mesma Meta App,
 * assinatura HMAC compartilhada). Mesma regra de segurança de
 * tenantResolver.ts: conta Instagram desconhecida nunca grava em tenant
 * nenhum.
 */
import express from 'express';
import type { Server } from 'http';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createWebhooksRouter } from '../webhooks';
import { initDb } from '../../services/db';
import { createFakeSupabase } from '../../services/__tests__/fakeSupabase';

const TENANT_IG = '55555555-5555-5555-5555-555555555555';
const IG_ACCOUNT_ID = 'ig-account-conhecida';

let server: Server;
let baseUrl: string;
let supabase: ReturnType<typeof createFakeSupabase>;

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
  supabase = createFakeSupabase({
    tenant_instagram_credentials: [{ tenant_id: TENANT_IG, instagram_account_id: IG_ACCOUNT_ID, access_token: 'token-real' }],
  });
  initDb(supabase);
});

function instagramTextPayload(overrides: { accountId: string; messageId: string; senderId: string; text: string }) {
  return {
    object: 'instagram',
    entry: [
      {
        id: overrides.accountId,
        messaging: [{ sender: { id: overrides.senderId }, recipient: { id: overrides.accountId }, message: { mid: overrides.messageId, text: overrides.text } }],
      },
    ],
  };
}

describe('POST /webhook — dispatch object === "instagram"', () => {
  it('mensagem de conta Instagram cadastrada grava no tenant certo', async () => {
    const res = await fetch(`${baseUrl}/webhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(instagramTextPayload({ accountId: IG_ACCOUNT_ID, messageId: 'ig-mid-1', senderId: 'ig-user-1', text: 'Oi, quero saber mais' })),
    });
    expect(res.status).toBe(200);

    const rows = supabase.__tables.messages || [];
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ sender: 'lead', type: 'text', text: 'Oi, quero saber mais' });

    const conversations = supabase.__tables.conversations || [];
    expect(conversations).toHaveLength(1);
    expect(conversations[0]).toMatchObject({ tenant_id: TENANT_IG, phone: 'ig-user-1' });
  });

  it('mensagem de conta Instagram desconhecida é descartada, não grava em nenhum tenant', async () => {
    const res = await fetch(`${baseUrl}/webhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(instagramTextPayload({ accountId: 'ig-conta-nao-cadastrada', messageId: 'ig-mid-2', senderId: 'ig-user-2', text: 'Oi' })),
    });
    expect(res.status).toBe(200);
    expect(supabase.__tables.messages || []).toHaveLength(0);
    expect(supabase.__tables.conversations || []).toHaveLength(0);
  });

  it('mensagem eco (is_echo:true, sem eco pendente) vira mensagem nova sentBy=operator, não dispara resposta automática', async () => {
    const res = await fetch(`${baseUrl}/webhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        object: 'instagram',
        entry: [{ id: IG_ACCOUNT_ID, messaging: [{ sender: { id: 'ig-user-3' }, message: { mid: 'ig-mid-echo', text: 'Respondida direto pelo app', is_echo: true } }] }],
      }),
    });
    expect(res.status).toBe(200);

    const rows = supabase.__tables.messages || [];
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ sender: 'agent', sent_by: 'operator', type: 'text', text: 'Respondida direto pelo app' });
    expect(supabase.__tables.escalations || []).toHaveLength(0);
  });
});
