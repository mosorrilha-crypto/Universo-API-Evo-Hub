/**
 * Epic 4.6 (Porta A — Evolution API, QR Code): provisionamento de instância
 * nova pro tenant (POST) e renovação do QR Code (GET), sem exigir Business
 * Manager verificado pela Meta. A resposta real da Evolution API varia por
 * versão do servidor — os testes cobrem o "melhor esforço" de extrair
 * hash/QR de formatos conhecidos, e que a credencial sempre é persistida por
 * tenant (não mais uma instância global única).
 */
import express from 'express';
import type { Server } from 'http';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAdminRouter } from '../admin';
import { createFakeSupabase } from '../../services/__tests__/fakeSupabase';

const TENANT_ID = 'tenant-evo-1';
const EVOLUTION_API_URL = 'https://evolution.example.com';
const EVOLUTION_API_KEY = 'admin-global-key';

let server: Server;
let baseUrl: string;
let supabase: ReturnType<typeof createFakeSupabase>;
const realFetch = global.fetch;

function fakeAuthenticateToken(req: any, _res: any, next: any) {
  req.user = { id: 'op-admin', tenantId: TENANT_ID, role: 'saas_admin' };
  next();
}

function fakeAuthenticateAs(role: string, tenantId: string) {
  return (req: any, _res: any, next: any) => {
    req.user = { id: 'op-1', tenantId, role };
    next();
  };
}

function startServer(
  deps: { evolutionApiUrl?: string; evolutionApiKey?: string } = { evolutionApiUrl: EVOLUTION_API_URL, evolutionApiKey: EVOLUTION_API_KEY },
  authenticateToken: any = fakeAuthenticateToken
) {
  const app = express();
  app.use(express.json());
  app.use(
    createAdminRouter({
      authenticateToken,
      supabase: supabase as any,
      ...deps,
    })
  );
  return new Promise<{ server: Server; baseUrl: string }>((resolve) => {
    const s = app.listen(0, () => {
      const address = s.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      resolve({ server: s, baseUrl: `http://127.0.0.1:${port}` });
    });
  });
}

beforeEach(() => {
  supabase = createFakeSupabase({
    tenants: [{ id: TENANT_ID, slug: 'cliente-novo', name: 'Cliente Novo' }],
  });
});

afterEach(async () => {
  vi.unstubAllGlobals();
  global.fetch = realFetch;
  if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe('POST /api/admin/tenants/:id/evolution-instance', () => {
  it('cria a instância na Evolution API e persiste a credencial por tenant', async () => {
    global.fetch = vi.fn(async (url: any, options?: any) => {
      if (String(url).startsWith(baseUrl)) return realFetch(url, options);
      expect(String(url)).toBe(`${EVOLUTION_API_URL}/instance/create`);
      return {
        ok: true,
        json: async () => ({ hash: { apikey: 'instance-specific-key' }, qrcode: { base64: 'data:image/png;base64,ABC123' } }),
      } as any;
    }) as any;

    ({ server, baseUrl } = await startServer());

    const res = await fetch(`${baseUrl}/api/admin/tenants/${TENANT_ID}/evolution-instance`, { method: 'POST' });
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.qrCodeBase64).toBe('data:image/png;base64,ABC123');
    expect(data.instanceName).toMatch(/^cliente-novo-/);

    const rows = supabase.__tables.tenant_evolution_credentials;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ tenant_id: TENANT_ID, api_url: EVOLUTION_API_URL, api_key: 'instance-specific-key' });
  });

  it('devolve 404 pra tenant inexistente', async () => {
    global.fetch = vi.fn(async (url: any, options?: any) => (String(url).startsWith(baseUrl) ? realFetch(url, options) : { ok: true, json: async () => ({}) })) as any;
    ({ server, baseUrl } = await startServer());

    const res = await fetch(`${baseUrl}/api/admin/tenants/nao-existe/evolution-instance`, { method: 'POST' });
    expect(res.status).toBe(404);
  });

  it('devolve 502 e não persiste nada quando a Evolution API recusa a criação', async () => {
    global.fetch = vi.fn(async (url: any, options?: any) => {
      if (String(url).startsWith(baseUrl)) return realFetch(url, options);
      return { ok: false, status: 500, json: async () => ({ error: 'instance limit reached' }) } as any;
    }) as any;
    ({ server, baseUrl } = await startServer());

    const res = await fetch(`${baseUrl}/api/admin/tenants/${TENANT_ID}/evolution-instance`, { method: 'POST' });
    expect(res.status).toBe(502);
    expect(supabase.__tables.tenant_evolution_credentials || []).toHaveLength(0);
  });

  it('503 quando o servidor não tem EVOLUTION_API_URL/KEY configurados', async () => {
    ({ server, baseUrl } = await startServer({}));
    const res = await fetch(`${baseUrl}/api/admin/tenants/${TENANT_ID}/evolution-instance`, { method: 'POST' });
    expect(res.status).toBe(503);
  });

  it('admin do próprio tenant também pode provisionar (não só saas_admin)', async () => {
    global.fetch = vi.fn(async (url: any, options?: any) => {
      if (String(url).startsWith(baseUrl)) return realFetch(url, options);
      return {
        ok: true,
        json: async () => ({ hash: { apikey: 'instance-specific-key' }, qrcode: { base64: 'data:image/png;base64,ABC123' } }),
      } as any;
    }) as any;
    ({ server, baseUrl } = await startServer(
      { evolutionApiUrl: EVOLUTION_API_URL, evolutionApiKey: EVOLUTION_API_KEY },
      fakeAuthenticateAs('admin', TENANT_ID)
    ));

    const res = await fetch(`${baseUrl}/api/admin/tenants/${TENANT_ID}/evolution-instance`, { method: 'POST' });
    expect(res.status).toBe(201);
  });

  it('403 quando um admin tenta provisionar instância de OUTRO tenant', async () => {
    global.fetch = vi.fn(async (url: any, options?: any) => (String(url).startsWith(baseUrl) ? realFetch(url, options) : { ok: true, json: async () => ({}) })) as any;
    ({ server, baseUrl } = await startServer(
      { evolutionApiUrl: EVOLUTION_API_URL, evolutionApiKey: EVOLUTION_API_KEY },
      fakeAuthenticateAs('admin', 'outro-tenant-id')
    ));

    const res = await fetch(`${baseUrl}/api/admin/tenants/${TENANT_ID}/evolution-instance`, { method: 'POST' });
    expect(res.status).toBe(403);
  });

  it('403 quando o papel é abaixo de admin (operator/manager)', async () => {
    global.fetch = vi.fn(async (url: any, options?: any) => (String(url).startsWith(baseUrl) ? realFetch(url, options) : { ok: true, json: async () => ({}) })) as any;
    ({ server, baseUrl } = await startServer(
      { evolutionApiUrl: EVOLUTION_API_URL, evolutionApiKey: EVOLUTION_API_KEY },
      fakeAuthenticateAs('manager', TENANT_ID)
    ));

    const res = await fetch(`${baseUrl}/api/admin/tenants/${TENANT_ID}/evolution-instance`, { method: 'POST' });
    expect(res.status).toBe(403);
  });
});

describe('GET /api/admin/tenants/:id/evolution-instance/qrcode', () => {
  it('busca um QR Code novo pra instância já criada', async () => {
    supabase.__tables.tenant_evolution_credentials = [
      { tenant_id: TENANT_ID, instance_name: 'cliente-novo-abc123', api_url: EVOLUTION_API_URL, api_key: 'instance-specific-key' },
    ];
    global.fetch = vi.fn(async (url: any, options?: any) => {
      if (String(url).startsWith(baseUrl)) return realFetch(url, options);
      expect(String(url)).toBe(`${EVOLUTION_API_URL}/instance/connect/cliente-novo-abc123`);
      return { ok: true, json: async () => ({ base64: 'data:image/png;base64,NOVOQR' }) } as any;
    }) as any;
    ({ server, baseUrl } = await startServer());

    const res = await fetch(`${baseUrl}/api/admin/tenants/${TENANT_ID}/evolution-instance/qrcode`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.qrCodeBase64).toBe('data:image/png;base64,NOVOQR');
  });

  it('404 quando o tenant ainda não tem instância criada', async () => {
    global.fetch = vi.fn(async (url: any, options?: any) => (String(url).startsWith(baseUrl) ? realFetch(url, options) : { ok: true, json: async () => ({}) })) as any;
    ({ server, baseUrl } = await startServer());

    const res = await fetch(`${baseUrl}/api/admin/tenants/${TENANT_ID}/evolution-instance/qrcode`);
    expect(res.status).toBe(404);
  });

  it('403 quando um admin tenta buscar o QR Code de OUTRO tenant', async () => {
    supabase.__tables.tenant_evolution_credentials = [
      { tenant_id: TENANT_ID, instance_name: 'cliente-novo-abc123', api_url: EVOLUTION_API_URL, api_key: 'instance-specific-key' },
    ];
    global.fetch = vi.fn(async (url: any, options?: any) => (String(url).startsWith(baseUrl) ? realFetch(url, options) : { ok: true, json: async () => ({}) })) as any;
    ({ server, baseUrl } = await startServer(
      { evolutionApiUrl: EVOLUTION_API_URL, evolutionApiKey: EVOLUTION_API_KEY },
      fakeAuthenticateAs('admin', 'outro-tenant-id')
    ));

    const res = await fetch(`${baseUrl}/api/admin/tenants/${TENANT_ID}/evolution-instance/qrcode`);
    expect(res.status).toBe(403);
  });
});
