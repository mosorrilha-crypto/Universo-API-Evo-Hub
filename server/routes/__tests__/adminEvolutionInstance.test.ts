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
const PUBLIC_BASE_URL = 'https://universo.example.com';

let server: Server;
let baseUrl: string;
let supabase: ReturnType<typeof createFakeSupabase>;
const realFetch = global.fetch;

function fakeAuthenticateToken(req: any, _res: any, next: any) {
  req.user = { id: 'op-admin', tenantId: TENANT_ID, role: 'saas_admin' };
  next();
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
      publicBaseUrl: PUBLIC_BASE_URL,
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
  it('cria a instância na Evolution API, persiste a credencial por tenant e configura o webhook de volta pro Universo', async () => {
    let webhookCall: { url: string; body: any } | undefined;
    global.fetch = vi.fn(async (url: any, options?: any) => {
      const urlStr = String(url);
      if (urlStr.startsWith(baseUrl)) return realFetch(url, options);
      if (urlStr === `${EVOLUTION_API_URL}/instance/create`) {
        return {
          ok: true,
          json: async () => ({ hash: { apikey: 'instance-specific-key' }, qrcode: { base64: 'data:image/png;base64,ABC123' } }),
        } as any;
      }
      if (urlStr.startsWith(`${EVOLUTION_API_URL}/webhook/set/`)) {
        webhookCall = { url: urlStr, body: JSON.parse(options.body) };
        return { ok: true, json: async () => ({}) } as any;
      }
      throw new Error(`URL inesperada no teste: ${urlStr}`);
    }) as any;

    ({ server, baseUrl } = await startServer());

    const res = await fetch(`${baseUrl}/api/admin/tenants/${TENANT_ID}/evolution-instance`, { method: 'POST' });
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.qrCodeBase64).toBe('data:image/png;base64,ABC123');
    expect(data.instanceName).toMatch(/^cliente-novo-/);
    expect(data.warning).toBeUndefined();

    const rows = supabase.__tables.tenant_evolution_credentials;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ tenant_id: TENANT_ID, api_url: EVOLUTION_API_URL, api_key: 'instance-specific-key' });

    expect(webhookCall?.url).toBe(`${EVOLUTION_API_URL}/webhook/set/${data.instanceName}`);
    expect(webhookCall?.body).toEqual({
      webhook: { enabled: true, url: `${PUBLIC_BASE_URL}/api/webhooks/evolution`, events: ['MESSAGES_UPSERT'] },
    });
  });

  it('bug real (12/08/2026): instância criada mas webhook não configurado — devolve warning em vez de deixar a instância muda pra sempre', async () => {
    global.fetch = vi.fn(async (url: any, options?: any) => {
      const urlStr = String(url);
      if (urlStr.startsWith(baseUrl)) return realFetch(url, options);
      if (urlStr === `${EVOLUTION_API_URL}/instance/create`) {
        return { ok: true, json: async () => ({ hash: { apikey: 'instance-specific-key' }, qrcode: { base64: 'data:image/png;base64,ABC123' } }) } as any;
      }
      if (urlStr.startsWith(`${EVOLUTION_API_URL}/webhook/set/`)) {
        return { ok: false, status: 500, json: async () => ({ error: 'boom' }) } as any;
      }
      throw new Error(`URL inesperada no teste: ${urlStr}`);
    }) as any;

    ({ server, baseUrl } = await startServer());

    const res = await fetch(`${baseUrl}/api/admin/tenants/${TENANT_ID}/evolution-instance`, { method: 'POST' });
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.qrCodeBase64).toBe('data:image/png;base64,ABC123');
    expect(data.warning).toMatch(/webhook/i);

    // A instância e a credencial continuam salvas mesmo com o webhook falho
    // — reabrir o QR Code (rota GET .../qrcode) tenta configurar de novo.
    expect(supabase.__tables.tenant_evolution_credentials).toHaveLength(1);
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

  it('bug real (12/08/2026): tenant que já tem instância — reusa em vez de tentar criar outra e quebrar com "duplicate key"', async () => {
    supabase.__tables.tenant_evolution_credentials = [
      { tenant_id: TENANT_ID, instance_name: 'cliente-novo-abc123', api_url: EVOLUTION_API_URL, api_key: 'instance-specific-key' },
    ];
    let createCalled = false;
    let webhookCall: { url: string; body: any } | undefined;
    global.fetch = vi.fn(async (url: any, options?: any) => {
      const urlStr = String(url);
      if (urlStr.startsWith(baseUrl)) return realFetch(url, options);
      if (urlStr === `${EVOLUTION_API_URL}/instance/create`) {
        createCalled = true;
        return { ok: true, json: async () => ({ hash: { apikey: 'outra-key' }, qrcode: { base64: 'NAO-DEVERIA-CRIAR' } }) } as any;
      }
      if (urlStr === `${EVOLUTION_API_URL}/instance/connect/cliente-novo-abc123`) {
        return { ok: true, json: async () => ({ base64: 'data:image/png;base64,QR-REUSADO' }) } as any;
      }
      if (urlStr.startsWith(`${EVOLUTION_API_URL}/webhook/set/`)) {
        webhookCall = { url: urlStr, body: JSON.parse(options.body) };
        return { ok: true, json: async () => ({}) } as any;
      }
      throw new Error(`URL inesperada no teste: ${urlStr}`);
    }) as any;
    ({ server, baseUrl } = await startServer());

    const res = await fetch(`${baseUrl}/api/admin/tenants/${TENANT_ID}/evolution-instance`, { method: 'POST' });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.instanceName).toBe('cliente-novo-abc123');
    expect(data.qrCodeBase64).toBe('data:image/png;base64,QR-REUSADO');
    expect(createCalled).toBe(false);
    expect(webhookCall?.url).toBe(`${EVOLUTION_API_URL}/webhook/set/cliente-novo-abc123`);

    // Continua uma credencial só — nenhuma segunda instância/linha criada.
    expect(supabase.__tables.tenant_evolution_credentials).toHaveLength(1);
  });
});

describe('GET /api/admin/tenants/:id/evolution-instance/qrcode', () => {
  it('busca um QR Code novo pra instância já criada e reafirma o webhook', async () => {
    supabase.__tables.tenant_evolution_credentials = [
      { tenant_id: TENANT_ID, instance_name: 'cliente-novo-abc123', api_url: EVOLUTION_API_URL, api_key: 'instance-specific-key' },
    ];
    let webhookCall: { url: string; body: any } | undefined;
    global.fetch = vi.fn(async (url: any, options?: any) => {
      const urlStr = String(url);
      if (urlStr.startsWith(baseUrl)) return realFetch(url, options);
      if (urlStr === `${EVOLUTION_API_URL}/instance/connect/cliente-novo-abc123`) {
        return { ok: true, json: async () => ({ base64: 'data:image/png;base64,NOVOQR' }) } as any;
      }
      if (urlStr.startsWith(`${EVOLUTION_API_URL}/webhook/set/`)) {
        webhookCall = { url: urlStr, body: JSON.parse(options.body) };
        return { ok: true, json: async () => ({}) } as any;
      }
      throw new Error(`URL inesperada no teste: ${urlStr}`);
    }) as any;
    ({ server, baseUrl } = await startServer());

    const res = await fetch(`${baseUrl}/api/admin/tenants/${TENANT_ID}/evolution-instance/qrcode`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.qrCodeBase64).toBe('data:image/png;base64,NOVOQR');
    expect(data.warning).toBeUndefined();
    expect(webhookCall?.url).toBe(`${EVOLUTION_API_URL}/webhook/set/cliente-novo-abc123`);
    expect(webhookCall?.body).toEqual({
      webhook: { enabled: true, url: `${PUBLIC_BASE_URL}/api/webhooks/evolution`, events: ['MESSAGES_UPSERT'] },
    });
  });

  it('bug real (12/08/2026): reabrir o QR de uma instância criada ANTES da correção também conserta o webhook dela', async () => {
    supabase.__tables.tenant_evolution_credentials = [
      { tenant_id: TENANT_ID, instance_name: 'cliente-novo-abc123', api_url: EVOLUTION_API_URL, api_key: 'instance-specific-key' },
    ];
    global.fetch = vi.fn(async (url: any, options?: any) => {
      const urlStr = String(url);
      if (urlStr.startsWith(baseUrl)) return realFetch(url, options);
      if (urlStr === `${EVOLUTION_API_URL}/instance/connect/cliente-novo-abc123`) {
        return { ok: true, json: async () => ({ base64: 'data:image/png;base64,NOVOQR' }) } as any;
      }
      if (urlStr.startsWith(`${EVOLUTION_API_URL}/webhook/set/`)) {
        return { ok: false, status: 500, json: async () => ({ error: 'boom' }) } as any;
      }
      throw new Error(`URL inesperada no teste: ${urlStr}`);
    }) as any;
    ({ server, baseUrl } = await startServer());

    const res = await fetch(`${baseUrl}/api/admin/tenants/${TENANT_ID}/evolution-instance/qrcode`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.qrCodeBase64).toBe('data:image/png;base64,NOVOQR');
    expect(data.warning).toMatch(/webhook/i);
  });

  it('404 quando o tenant ainda não tem instância criada', async () => {
    global.fetch = vi.fn(async (url: any, options?: any) => (String(url).startsWith(baseUrl) ? realFetch(url, options) : { ok: true, json: async () => ({}) })) as any;
    ({ server, baseUrl } = await startServer());

    const res = await fetch(`${baseUrl}/api/admin/tenants/${TENANT_ID}/evolution-instance/qrcode`);
    expect(res.status).toBe(404);
  });
});

describe('GET /api/admin/tenants/:id/evolution-instance/status', () => {
  it('devolve connected=true quando o estado da instância é "open"', async () => {
    supabase.__tables.tenant_evolution_credentials = [
      { tenant_id: TENANT_ID, instance_name: 'cliente-novo-abc123', api_url: EVOLUTION_API_URL, api_key: 'instance-specific-key' },
    ];
    global.fetch = vi.fn(async (url: any, options?: any) => {
      if (String(url).startsWith(baseUrl)) return realFetch(url, options);
      expect(String(url)).toBe(`${EVOLUTION_API_URL}/instance/connectionState/cliente-novo-abc123`);
      return { ok: true, json: async () => ({ instance: { instanceName: 'cliente-novo-abc123', state: 'open' } }) } as any;
    }) as any;
    ({ server, baseUrl } = await startServer());

    const res = await fetch(`${baseUrl}/api/admin/tenants/${TENANT_ID}/evolution-instance/status`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toMatchObject({ state: 'open', connected: true });
  });

  it('devolve connected=false enquanto o estado ainda é "connecting"', async () => {
    supabase.__tables.tenant_evolution_credentials = [
      { tenant_id: TENANT_ID, instance_name: 'cliente-novo-abc123', api_url: EVOLUTION_API_URL, api_key: 'instance-specific-key' },
    ];
    global.fetch = vi.fn(async (url: any, options?: any) => {
      if (String(url).startsWith(baseUrl)) return realFetch(url, options);
      return { ok: true, json: async () => ({ state: 'connecting' }) } as any;
    }) as any;
    ({ server, baseUrl } = await startServer());

    const res = await fetch(`${baseUrl}/api/admin/tenants/${TENANT_ID}/evolution-instance/status`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toMatchObject({ state: 'connecting', connected: false });
  });

  it('404 quando o tenant ainda não tem instância criada', async () => {
    global.fetch = vi.fn(async (url: any, options?: any) => (String(url).startsWith(baseUrl) ? realFetch(url, options) : { ok: true, json: async () => ({}) })) as any;
    ({ server, baseUrl } = await startServer());

    const res = await fetch(`${baseUrl}/api/admin/tenants/${TENANT_ID}/evolution-instance/status`);
    expect(res.status).toBe(404);
  });
});

// Pedido real (15/08/2026, incidente Clic Piscinas): admin comum (não
// saas_admin) do próprio tenant também precisa conseguir reconectar via QR
// Code, sem depender de alguém com saas_admin. As três rotas acima passaram
// de requireRole('saas_admin') pra requireRole('admin') + resolveEvolutionTenantId,
// que ignora o :id da URL pra quem não é saas_admin e sempre usa o tenantId
// do JWT — os testes abaixo provam que um admin não consegue usar essa rota
// pra mexer na conexão de OUTRO tenant só trocando o :id na URL.
describe('escopo por tenant pra admin comum (não saas_admin)', () => {
  const OTHER_TENANT_ID = 'tenant-de-outra-empresa';

  function fakeAuthenticateTokenAsAdmin(req: any, _res: any, next: any) {
    req.user = { id: 'op-admin-comum', tenantId: TENANT_ID, role: 'admin' };
    next();
  }

  it('POST .../evolution-instance com :id de OUTRO tenant na URL ainda assim cria a instância no tenant do próprio JWT', async () => {
    global.fetch = vi.fn(async (url: any, options?: any) => {
      const urlStr = String(url);
      if (urlStr.startsWith(baseUrl)) return realFetch(url, options);
      if (urlStr === `${EVOLUTION_API_URL}/instance/create`) {
        return { ok: true, json: async () => ({ hash: { apikey: 'instance-specific-key' }, qrcode: { base64: 'data:image/png;base64,ABC123' } }) } as any;
      }
      if (urlStr.startsWith(`${EVOLUTION_API_URL}/webhook/set/`)) {
        return { ok: true, json: async () => ({}) } as any;
      }
      throw new Error(`URL inesperada no teste: ${urlStr}`);
    }) as any;
    ({ server, baseUrl } = await startServer(undefined, fakeAuthenticateTokenAsAdmin));

    const res = await fetch(`${baseUrl}/api/admin/tenants/${OTHER_TENANT_ID}/evolution-instance`, { method: 'POST' });
    expect(res.status).toBe(201);

    const rows = supabase.__tables.tenant_evolution_credentials;
    expect(rows).toHaveLength(1);
    expect(rows[0].tenant_id).toBe(TENANT_ID);
    expect(rows[0].tenant_id).not.toBe(OTHER_TENANT_ID);
  });

  it('GET .../evolution-instance/status com :id de OUTRO tenant na URL consulta o tenant do próprio JWT, não o da URL', async () => {
    supabase.__tables.tenant_evolution_credentials = [
      { tenant_id: TENANT_ID, instance_name: 'minha-instancia', api_url: EVOLUTION_API_URL, api_key: 'instance-specific-key' },
      { tenant_id: OTHER_TENANT_ID, instance_name: 'instancia-de-outra-empresa', api_url: EVOLUTION_API_URL, api_key: 'outra-key' },
    ];
    global.fetch = vi.fn(async (url: any, options?: any) => {
      if (String(url).startsWith(baseUrl)) return realFetch(url, options);
      expect(String(url)).toBe(`${EVOLUTION_API_URL}/instance/connectionState/minha-instancia`);
      return { ok: true, json: async () => ({ instance: { state: 'open' } }) } as any;
    }) as any;
    ({ server, baseUrl } = await startServer(undefined, fakeAuthenticateTokenAsAdmin));

    const res = await fetch(`${baseUrl}/api/admin/tenants/${OTHER_TENANT_ID}/evolution-instance/status`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.instanceName).toBe('minha-instancia');
  });

  it('403 pra operator/manager — só admin+ consegue reconectar', async () => {
    function fakeAuthenticateTokenAsOperator(req: any, _res: any, next: any) {
      req.user = { id: 'op-comum', tenantId: TENANT_ID, role: 'operator' };
      next();
    }
    global.fetch = vi.fn(async (url: any, options?: any) => (String(url).startsWith(baseUrl) ? realFetch(url, options) : { ok: true, json: async () => ({}) })) as any;
    ({ server, baseUrl } = await startServer(undefined, fakeAuthenticateTokenAsOperator));

    const res = await fetch(`${baseUrl}/api/admin/tenants/${TENANT_ID}/evolution-instance`, { method: 'POST' });
    expect(res.status).toBe(403);
  });
});
