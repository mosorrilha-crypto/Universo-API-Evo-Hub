/**
 * Postar Status/Stories da empresa (pedido real do dono do produto,
 * 12/08/2026: fotos de antes/depois de procedimento já aquecem lead
 * comprovadamente). Só existe pra tenants conectados via Evolution API —
 * a Meta Cloud API oficial (canal da Monique hoje) não tem Status nenhum.
 */
import express from 'express';
import type { Server } from 'http';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { createConversationsRouter } from '../conversations';
import { initDb } from '../../services/db';
import { createFakeSupabase } from '../../services/__tests__/fakeSupabase';

const TENANT_EVOLUTION = 'tenant-evo';
const TENANT_META = 'tenant-meta';
const realFetch = global.fetch;

let server: Server;
let baseUrl: string;

function fakeAuthenticateToken(tenantId: string): any {
  return (req: any, _res: any, next: any) => {
    req.user = { id: 'op-1', tenantId, role: 'admin' };
    next();
  };
}

function makeApp(tenantId: string) {
  const app = express();
  app.use(express.json({ limit: '10mb' }));
  app.use(
    createConversationsRouter({
      authenticateToken: fakeAuthenticateToken(tenantId) as any,
      jwtSecret: 'test-secret',
      metaAccessToken: 'shared-meta-token',
      metaPhoneNumberId: 'shared-pn-id',
    })
  );
  return app;
}

function seed() {
  initDb(
    createFakeSupabase({
      tenants: [{ id: TENANT_EVOLUTION, name: 'Studio Evolution' }, { id: TENANT_META, name: 'Studio Meta' }],
      tenant_evolution_credentials: [{ tenant_id: TENANT_EVOLUTION, instance_name: 'inst-evo', api_url: 'https://evo.example.com', api_key: 'evo-key' }],
    })
  );
}

afterEach(() => {
  global.fetch = realFetch;
});

describe('GET /api/status/available', () => {
  it('true pra tenant conectado via Evolution API', async () => {
    seed();
    const app = makeApp(TENANT_EVOLUTION);
    server = app.listen(0);
    await new Promise((resolve) => server.once('listening', resolve));
    const address = server.address();
    baseUrl = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`;

    const res = await fetch(`${baseUrl}/api/status/available`);
    expect(res.status).toBe(200);
    expect((await res.json()).available).toBe(true);
    server.close();
  });

  it('false pra tenant só na Meta Cloud API oficial (canal da Monique hoje)', async () => {
    seed();
    const app = makeApp(TENANT_META);
    server = app.listen(0);
    await new Promise((resolve) => server.once('listening', resolve));
    const address = server.address();
    baseUrl = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`;

    const res = await fetch(`${baseUrl}/api/status/available`);
    expect(res.status).toBe(200);
    expect((await res.json()).available).toBe(false);
    server.close();
  });
});

describe('POST /api/status', () => {
  it('400 quando não vem nem texto nem imagem', async () => {
    seed();
    const app = makeApp(TENANT_EVOLUTION);
    server = app.listen(0);
    await new Promise((resolve) => server.once('listening', resolve));
    const address = server.address();
    baseUrl = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`;

    const res = await fetch(`${baseUrl}/api/status`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
    server.close();
  });

  it('400 quando o tenant não está conectado via Evolution API (canal Meta oficial)', async () => {
    seed();
    const app = makeApp(TENANT_META);
    server = app.listen(0);
    await new Promise((resolve) => server.once('listening', resolve));
    const address = server.address();
    baseUrl = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`;

    const res = await fetch(`${baseUrl}/api/status`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: 'Promoção de sábado!' }),
    });
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toMatch(/Meta Cloud API/);
    server.close();
  });

  it('posta status de texto via Evolution API (POST /message/sendStatus/{instance})', async () => {
    seed();
    const app = makeApp(TENANT_EVOLUTION);
    server = app.listen(0);
    await new Promise((resolve) => server.once('listening', resolve));
    const address = server.address();
    baseUrl = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`;

    let capturedUrl: string | undefined;
    let capturedBody: any;
    global.fetch = vi.fn(async (url: any, options?: any) => {
      if (String(url).startsWith(baseUrl)) return realFetch(url, options);
      capturedUrl = String(url);
      capturedBody = JSON.parse(options.body);
      return { ok: true, json: async () => ({}) } as any;
    }) as any;

    const res = await fetch(`${baseUrl}/api/status`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: 'Vagas abertas pra sábado!', backgroundColor: '#25D366' }),
    });
    expect(res.status).toBe(200);
    expect(capturedUrl).toBe('https://evo.example.com/message/sendStatus/inst-evo');
    expect(capturedBody).toEqual({ type: 'text', content: 'Vagas abertas pra sábado!', backgroundColor: '#25D366', allContacts: true });
    server.close();
  });

  it('posta status de imagem com legenda', async () => {
    seed();
    const app = makeApp(TENANT_EVOLUTION);
    server = app.listen(0);
    await new Promise((resolve) => server.once('listening', resolve));
    const address = server.address();
    baseUrl = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`;

    let capturedBody: any;
    global.fetch = vi.fn(async (url: any, options?: any) => {
      if (String(url).startsWith(baseUrl)) return realFetch(url, options);
      capturedBody = JSON.parse(options.body);
      return { ok: true, json: async () => ({}) } as any;
    }) as any;

    const res = await fetch(`${baseUrl}/api/status`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ imageBase64: 'ZmFrZS1pbWFnZQ==', caption: 'Antes e depois 😍' }),
    });
    expect(res.status).toBe(200);
    expect(capturedBody).toEqual({ type: 'image', content: 'ZmFrZS1pbWFnZQ==', caption: 'Antes e depois 😍', allContacts: true });
    server.close();
  });

  it('502 quando a Evolution API responde com falha', async () => {
    seed();
    const app = makeApp(TENANT_EVOLUTION);
    server = app.listen(0);
    await new Promise((resolve) => server.once('listening', resolve));
    const address = server.address();
    baseUrl = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`;

    global.fetch = vi.fn(async (url: any, options?: any) => {
      if (String(url).startsWith(baseUrl)) return realFetch(url, options);
      return { ok: false, status: 500, json: async () => ({ error: 'boom' }) } as any;
    }) as any;

    const res = await fetch(`${baseUrl}/api/status`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: 'oi' }),
    });
    expect(res.status).toBe(502);
    server.close();
  });
});
