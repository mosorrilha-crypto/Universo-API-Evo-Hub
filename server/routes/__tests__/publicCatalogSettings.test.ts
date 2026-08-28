/**
 * GET/PUT /api/public-catalog-settings (23/08/2026) — até aqui a config do
 * catálogo público (opt-in + contato) só dava pra editar via SQL direto no
 * Supabase, e isso causou um bug real em produção: o contato da Monique
 * ficou salvo no tenant errado depois que o slug "monique" foi reaproveitado
 * por outro tenant. A rota é escopada só por `tenantOf(req)` (nunca por
 * slug/id vindo do cliente) pra eliminar essa classe de erro.
 */
import express from 'express';
import type { Server } from 'http';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

const { createConversationsRouter } = await import('../conversations');
const { initDb } = await import('../../services/db');
const { createFakeSupabase } = await import('../../services/__tests__/fakeSupabase');

const TENANT_A = 'tenant-a';
const TENANT_B = 'tenant-b';

let server: Server;
let baseUrl: string;
let supabase: ReturnType<typeof createFakeSupabase>;
let currentTenant = TENANT_A;
let currentRole = 'admin';

function fakeAuthenticateToken(req: any, _res: any, next: any) {
  req.user = { id: 'op-1', tenantId: currentTenant, role: currentRole };
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
  currentTenant = TENANT_A;
  currentRole = 'admin';
  supabase = createFakeSupabase({
    tenants: [
      { id: TENANT_A, slug: 'tenant-a-slug', public_catalog_enabled: false },
      { id: TENANT_B, slug: 'tenant-b-slug', public_catalog_enabled: true, public_whatsapp_phone: '5551234' },
    ],
  });
  initDb(supabase as any);
});

describe('GET /api/public-catalog-settings', () => {
  it('devolve os campos do próprio tenant, com string vazia quando não configurado', async () => {
    const res = await fetch(`${baseUrl}/api/public-catalog-settings`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      slug: 'tenant-a-slug',
      enabled: false,
      whatsappPhone: '',
      instagramUrl: '',
      locationMapsUrl: '',
      address: '',
      hoursLabel: '',
      whatsappMessageGeneral: '',
      whatsappMessageProduct: '',
    });
  });

  it('nunca devolve o dado de outro tenant', async () => {
    const res = await fetch(`${baseUrl}/api/public-catalog-settings`);
    const body = await res.json();
    expect(body.whatsappPhone).not.toBe('5551234');
  });
});

describe('GET /api/public-catalog-settings/analytics', () => {
  it('agrega os cliques do próprio tenant — totais, últimos 7/30 dias, por produto e recentes', async () => {
    const now = new Date();
    supabase.__tables.public_catalog_whatsapp_clicks = [
      { id: 'click-1', tenant_id: TENANT_A, code: '💕', product: 'Combo Full Face', source: 'legacy', message: 'oi 💕', created_at: now.toISOString(), matched_at: now.toISOString(), matched_phone: '595981111111' },
      { id: 'click-2', tenant_id: TENANT_A, code: '🌸', product: 'Combo Full Face', source: 'novo', message: 'oi 🌸', created_at: now.toISOString(), matched_at: null, matched_phone: null },
      { id: 'click-3', tenant_id: TENANT_A, code: '✨', product: null, source: null, message: 'oi ✨', created_at: now.toISOString(), matched_at: null, matched_phone: null },
      // outro tenant — nunca deve aparecer no relatório do TENANT_A
      { id: 'click-4', tenant_id: TENANT_B, code: '🦋', product: 'Combo Full Face', source: 'novo', message: 'oi 🦋', created_at: now.toISOString(), matched_at: now.toISOString(), matched_phone: '595982222222' },
    ];

    const res = await fetch(`${baseUrl}/api/public-catalog-settings/analytics`);
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.totalClicks).toBe(3);
    expect(body.totalMatched).toBe(1);
    expect(body.last7d).toEqual({ clicks: 3, matched: 1 });
    expect(body.byProduct).toEqual(
      expect.arrayContaining([
        { product: 'Combo Full Face', clicks: 2, matched: 1 },
        { product: 'Geral (botão sem produto específico)', clicks: 1, matched: 0 },
      ])
    );
    // clique sem source (null, ex: anterior a esta coluna) conta como "legacy" — junto com click-1
    expect(body.bySource).toEqual(
      expect.arrayContaining([
        { source: 'legacy', clicks: 2, matched: 1 },
        { source: 'novo', clicks: 1, matched: 0 },
      ])
    );
    expect(body.recent).toHaveLength(3);
    expect(body.recent.some((r: any) => r.matchedPhone === '595982222222')).toBe(false);
    // lista de números (leads) — só clique com matched_phone, nunca de outro tenant
    expect(body.leads).toEqual([
      { phone: '595981111111', product: 'Combo Full Face', source: 'legacy', matchedAt: now.toISOString() },
    ]);
  });

  it('lead com o mesmo telefone clicando mais de uma vez aparece uma vez só, com o clique mais recente', async () => {
    const older = new Date(Date.now() - 60_000);
    const newer = new Date();
    supabase.__tables.public_catalog_whatsapp_clicks = [
      { id: 'click-1', tenant_id: TENANT_A, code: '💕', product: 'Combo Full Face', source: 'legacy', message: 'oi', created_at: older.toISOString(), matched_at: older.toISOString(), matched_phone: '595981111111' },
      { id: 'click-2', tenant_id: TENANT_A, code: '🌸', product: 'Microlips Labios', source: 'novo', message: 'oi', created_at: newer.toISOString(), matched_at: newer.toISOString(), matched_phone: '595981111111' },
    ];

    const res = await fetch(`${baseUrl}/api/public-catalog-settings/analytics`);
    const body = await res.json();
    expect(body.leads).toEqual([
      { phone: '595981111111', product: 'Microlips Labios', source: 'novo', matchedAt: newer.toISOString() },
    ]);
  });

  it('sem clique nenhum, devolve tudo zerado sem lançar erro', async () => {
    const res = await fetch(`${baseUrl}/api/public-catalog-settings/analytics`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.totalClicks).toBe(0);
    expect(body.byProduct).toEqual([]);
    expect(body.recent).toEqual([]);
    expect(body.leads).toEqual([]);
  });
});

describe('PUT /api/public-catalog-settings', () => {
  it('salva os campos e passa a devolvê-los no GET', async () => {
    const put = await fetch(`${baseUrl}/api/public-catalog-settings`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        enabled: true,
        whatsappPhone: '595981436141',
        instagramUrl: 'https://instagram.com/pestanaspormonique',
        locationMapsUrl: 'https://maps.example/x',
        address: 'Rua X, 123',
        hoursLabel: 'Lun-Vie 8-18h',
        whatsappMessageGeneral: 'Hola, quiero info general.',
        whatsappMessageProduct: 'Hola, quiero info sobre {produto}.',
      }),
    });
    expect(put.status).toBe(200);

    const get = await fetch(`${baseUrl}/api/public-catalog-settings`);
    const body = await get.json();
    expect(body.enabled).toBe(true);
    expect(body.whatsappPhone).toBe('595981436141');
    expect(body.instagramUrl).toBe('https://instagram.com/pestanaspormonique');
    expect(body.whatsappMessageGeneral).toBe('Hola, quiero info general.');
    expect(body.whatsappMessageProduct).toBe('Hola, quiero info sobre {produto}.');
  });

  it('remove espaços e símbolos do WhatsApp ao salvar (achado de auditoria, 27/08/2026: "595994 798081" salvo com espaço quebrava o link do wa.me)', async () => {
    const put = await fetch(`${baseUrl}/api/public-catalog-settings`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: true, whatsappPhone: '595994 798081' }),
    });
    expect(put.status).toBe(200);

    const get = await fetch(`${baseUrl}/api/public-catalog-settings`);
    const body = await get.json();
    expect(body.whatsappPhone).toBe('595994798081');
  });

  it('rejeita ativar o catálogo público (enabled: true) num tenant sem slug definido', async () => {
    supabase = createFakeSupabase({
      tenants: [{ id: TENANT_A, slug: null, public_catalog_enabled: false }],
    });
    initDb(supabase as any);

    const res = await fetch(`${baseUrl}/api/public-catalog-settings`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: true, whatsappPhone: '595981436141' }),
    });
    expect(res.status).toBe(400);
    const tenantRow = supabase.__tables.tenants.find((t: any) => t.id === TENANT_A);
    expect(tenantRow.public_catalog_enabled).toBe(false);
  });

  it('permite desativar o catálogo (enabled: false) mesmo sem slug — só a ativação exige slug', async () => {
    supabase = createFakeSupabase({
      tenants: [{ id: TENANT_A, slug: null, public_catalog_enabled: false }],
    });
    initDb(supabase as any);

    const res = await fetch(`${baseUrl}/api/public-catalog-settings`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: false }),
    });
    expect(res.status).toBe(200);
  });

  it('nunca escreve no tenant de outra sessão', async () => {
    await fetch(`${baseUrl}/api/public-catalog-settings`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: true, whatsappPhone: '000' }),
    });

    const tenantBRow = supabase.__tables.tenants.find((t: any) => t.id === TENANT_B);
    expect(tenantBRow.public_whatsapp_phone).toBe('5551234');
  });

  it('campo "enabled" ausente/não-booleano é rejeitado com 400', async () => {
    const res = await fetch(`${baseUrl}/api/public-catalog-settings`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ whatsappPhone: '123' }),
    });
    expect(res.status).toBe(400);
  });

  it('papel abaixo de admin é rejeitado com 403', async () => {
    currentRole = 'operator';
    const res = await fetch(`${baseUrl}/api/public-catalog-settings`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: true }),
    });
    expect(res.status).toBe(403);
  });
});
