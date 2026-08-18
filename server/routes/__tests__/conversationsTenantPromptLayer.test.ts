/**
 * GET/PUT/DELETE /api/tenant-prompt-layer (18/08/2026, pedido real do dono
 * do produto) — Camada 1 (regras universais) passa a ser legível por
 * qualquer admin de tenant (evita duplicar/conflitar com uma regra que já
 * está coberta ali) e editável só pra esse tenant, atrás de confirmação de
 * senha. Sem edição prévia, herda a Camada 1 global; depois de editar,
 * nunca mais herda mudança futura da global (decisão do dono do produto).
 */
import express from 'express';
import type { Server } from 'http';
import bcrypt from 'bcrypt';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

const { createConversationsRouter } = await import('../conversations');
const { initDb } = await import('../../services/db');
const { createFakeSupabase } = await import('../../services/__tests__/fakeSupabase');
const { DEFAULT_GLOBAL_LAYER } = await import('../../services/globalPromptStore');

const TENANT_A = 'tenant-a';
const REAL_PASSWORD = 'senha-real-123';

let server: Server;
let baseUrl: string;
let supabase: ReturnType<typeof createFakeSupabase>;
let currentRole = 'admin';

function fakeAuthenticateToken(req: any, _res: any, next: any) {
  req.user = { id: 'op-1', tenantId: TENANT_A, role: currentRole };
  next();
}

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use(
    createConversationsRouter({
      authenticateToken: fakeAuthenticateToken as any,
      metaAccessToken: 'tok',
      jwtSecret: 'test-secret',
      metaPhoneNumberId: 'pn',
      supabaseUrl: 'https://fake.supabase.co',
      supabaseKey: 'fake-key',
    })
  );
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

beforeEach(async () => {
  currentRole = 'admin';
  supabase = createFakeSupabase({
    operators: [{ id: 'op-1', tenant_id: TENANT_A, password_hash: await bcrypt.hash(REAL_PASSWORD, 4) }],
  });
  initDb(supabase as any);
});

describe('GET /api/tenant-prompt-layer', () => {
  it('sem customização própria, devolve o texto padrão global e isCustomized:false', async () => {
    const res = await fetch(`${baseUrl}/api/tenant-prompt-layer`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.isCustomized).toBe(false);
    expect(body.content).toBe(DEFAULT_GLOBAL_LAYER);
  });

  it('papel abaixo de admin é rejeitado com 403', async () => {
    currentRole = 'operator';
    const res = await fetch(`${baseUrl}/api/tenant-prompt-layer`);
    expect(res.status).toBe(403);
  });
});

describe('PUT /api/tenant-prompt-layer', () => {
  it('com a senha certa, salva a customização e passa a devolvê-la (isCustomized:true)', async () => {
    const put = await fetch(`${baseUrl}/api/tenant-prompt-layer`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: 'Regra customizada só pra este tenant.', currentPassword: REAL_PASSWORD }),
    });
    expect(put.status).toBe(200);
    const putBody = await put.json();
    expect(putBody.isCustomized).toBe(true);
    expect(putBody.content).toBe('Regra customizada só pra este tenant.');

    const get = await fetch(`${baseUrl}/api/tenant-prompt-layer`);
    expect((await get.json()).content).toBe('Regra customizada só pra este tenant.');
  });

  it('com senha errada, rejeita com 401 e não altera nada', async () => {
    const res = await fetch(`${baseUrl}/api/tenant-prompt-layer`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: 'Tentativa maliciosa', currentPassword: 'senha-errada' }),
    });
    expect(res.status).toBe(401);

    const get = await fetch(`${baseUrl}/api/tenant-prompt-layer`);
    expect((await get.json()).isCustomized).toBe(false);
  });

  it('sem currentPassword é rejeitado com 400', async () => {
    const res = await fetch(`${baseUrl}/api/tenant-prompt-layer`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: 'Algo' }),
    });
    expect(res.status).toBe(400);
  });

  it('papel abaixo de admin é rejeitado com 403', async () => {
    currentRole = 'operator';
    const res = await fetch(`${baseUrl}/api/tenant-prompt-layer`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: 'Algo', currentPassword: REAL_PASSWORD }),
    });
    expect(res.status).toBe(403);
  });
});

describe('DELETE /api/tenant-prompt-layer (restaurar padrão)', () => {
  it('apaga a customização e volta a herdar a Camada 1 global', async () => {
    await fetch(`${baseUrl}/api/tenant-prompt-layer`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: 'Regra customizada', currentPassword: REAL_PASSWORD }),
    });

    const del = await fetch(`${baseUrl}/api/tenant-prompt-layer`, { method: 'DELETE' });
    expect(del.status).toBe(200);
    const delBody = await del.json();
    expect(delBody.isCustomized).toBe(false);
    expect(delBody.content).toBe(DEFAULT_GLOBAL_LAYER);
  });
});
