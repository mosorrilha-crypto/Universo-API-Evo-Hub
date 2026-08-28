/**
 * PATCH/DELETE /api/admin/tenants/:id — pedido real do dono do produto
 * depois de criar tenants de teste com nome errado ("Monique 2", "Tanent 3")
 * e não ter como corrigir/apagar sem SQL direto no Supabase.
 */
import express from 'express';
import type { Server } from 'http';
import { afterEach, describe, expect, it } from 'vitest';
import { createAdminRouter } from '../admin';
import { createFakeSupabase } from '../../services/__tests__/fakeSupabase';

let server: Server;
let baseUrl: string;
let supabase: ReturnType<typeof createFakeSupabase>;

function makeAuth(role: string) {
  return (req: any, _res: any, next: any) => {
    req.user = { id: 'op-1', tenantId: 'tenant-a', role };
    next();
  };
}

function startServer(role: string) {
  const app = express();
  app.use(express.json());
  app.use(createAdminRouter({ authenticateToken: makeAuth(role) as any, supabase: supabase as any, publicBaseUrl: 'https://universo.example.com' }));
  return new Promise<{ server: Server; baseUrl: string }>((resolve) => {
    const s = app.listen(0, () => {
      const address = s.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      resolve({ server: s, baseUrl: `http://127.0.0.1:${port}` });
    });
  });
}

afterEach(async () => {
  if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe('PATCH /api/admin/tenants/:id', () => {
  it('atualiza só os campos enviados', async () => {
    supabase = createFakeSupabase({ tenants: [{ id: 'tenant-a', name: 'Tanent 3', slug: null, currency: 'PYG', locale: 'es-PY', segment: 'generic' }] });
    ({ server, baseUrl } = await startServer('saas_admin'));

    const res = await fetch(`${baseUrl}/api/admin/tenants/tenant-a`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Clínica Bella Vita', segment: 'beauty_studio' }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.tenant).toMatchObject({ id: 'tenant-a', name: 'Clínica Bella Vita', segment: 'beauty_studio', currency: 'PYG' });
  });

  it('rejeita nome vazio', async () => {
    supabase = createFakeSupabase({ tenants: [{ id: 'tenant-a', name: 'X' }] });
    ({ server, baseUrl } = await startServer('saas_admin'));

    const res = await fetch(`${baseUrl}/api/admin/tenants/tenant-a`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: '   ' }),
    });
    expect(res.status).toBe(400);
  });

  it('404 pra tenant inexistente', async () => {
    supabase = createFakeSupabase({ tenants: [] });
    ({ server, baseUrl } = await startServer('saas_admin'));

    const res = await fetch(`${baseUrl}/api/admin/tenants/nao-existe`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Y' }),
    });
    expect(res.status).toBe(404);
  });

  // Incidente real em produção (27/08/2026): o slug do tenant real da Monique
  // foi trocado pra "Pestañas por Monique" (espaço + acento) ao editar o nome
  // pelo painel — a rota aceitava qualquer string, e isso derrubou os dois
  // catálogos públicos e os anúncios ativos até alguém notar e reverter via SQL.
  it('rejeita slug com espaço, acento ou maiúscula (nunca deixa o catálogo público cair)', async () => {
    supabase = createFakeSupabase({ tenants: [{ id: 'tenant-a', name: 'X', slug: 'monique-teste' }] });
    ({ server, baseUrl } = await startServer('saas_admin'));

    const res = await fetch(`${baseUrl}/api/admin/tenants/tenant-a`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ slug: 'Pestañas por Monique' }),
    });
    expect(res.status).toBe(400);
    expect(supabase.__tables.tenants.find((t: any) => t.id === 'tenant-a')?.slug).toBe('monique-teste');
  });

  it('aceita slug minúsculo com números e hífen', async () => {
    supabase = createFakeSupabase({ tenants: [{ id: 'tenant-a', name: 'X', slug: null }] });
    ({ server, baseUrl } = await startServer('saas_admin'));

    const res = await fetch(`${baseUrl}/api/admin/tenants/tenant-a`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ slug: 'clic-piscinas-2' }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.tenant.slug).toBe('clic-piscinas-2');
  });

  it('rejeita trocar o slug (mesmo em formato válido) de um tenant com catálogo público ativo', async () => {
    supabase = createFakeSupabase({ tenants: [{ id: 'tenant-a', name: 'X', slug: 'monique-teste', public_catalog_enabled: true }] });
    ({ server, baseUrl } = await startServer('saas_admin'));

    const res = await fetch(`${baseUrl}/api/admin/tenants/tenant-a`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ slug: 'monique-studio' }),
    });
    expect(res.status).toBe(400);
    expect(supabase.__tables.tenants.find((t: any) => t.id === 'tenant-a')?.slug).toBe('monique-teste');
  });

  it('permite salvar outros campos (ex: nome) num tenant com catálogo ativo, desde que o slug enviado seja o mesmo que já está salvo', async () => {
    supabase = createFakeSupabase({ tenants: [{ id: 'tenant-a', name: 'X', slug: 'monique-teste', public_catalog_enabled: true }] });
    ({ server, baseUrl } = await startServer('saas_admin'));

    const res = await fetch(`${baseUrl}/api/admin/tenants/tenant-a`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Monique - Evolution', slug: 'monique-teste' }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.tenant).toMatchObject({ name: 'Monique - Evolution', slug: 'monique-teste' });
  });

  it('permite trocar o slug livremente quando o catálogo público está desligado', async () => {
    supabase = createFakeSupabase({ tenants: [{ id: 'tenant-a', name: 'X', slug: 'antigo-slug', public_catalog_enabled: false }] });
    ({ server, baseUrl } = await startServer('saas_admin'));

    const res = await fetch(`${baseUrl}/api/admin/tenants/tenant-a`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ slug: 'novo-slug' }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.tenant.slug).toBe('novo-slug');
  });

  it('admin comum (não saas_admin) é rejeitado com 403', async () => {
    supabase = createFakeSupabase({ tenants: [{ id: 'tenant-a', name: 'X' }] });
    ({ server, baseUrl } = await startServer('admin'));
    const res = await fetch(`${baseUrl}/api/admin/tenants/tenant-a`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Y' }),
    });
    expect(res.status).toBe(403);
  });

  // TASK-0070 — bloqueio de acesso reversível (tenants.is_active), distinto
  // do DELETE abaixo (irreversível/em cascata).
  it('bloqueia o acesso do tenant (isActive: false)', async () => {
    supabase = createFakeSupabase({ tenants: [{ id: 'tenant-a', name: 'X', is_active: true }] });
    ({ server, baseUrl } = await startServer('saas_admin'));

    const res = await fetch(`${baseUrl}/api/admin/tenants/tenant-a`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ isActive: false }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.tenant.is_active).toBe(false);
  });

  it('reativa o tenant (isActive: true)', async () => {
    supabase = createFakeSupabase({ tenants: [{ id: 'tenant-a', name: 'X', is_active: false }] });
    ({ server, baseUrl } = await startServer('saas_admin'));

    const res = await fetch(`${baseUrl}/api/admin/tenants/tenant-a`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ isActive: true }),
    });
    const body = await res.json();
    expect(body.tenant.is_active).toBe(true);
  });
});

describe('DELETE /api/admin/tenants/:id', () => {
  it('exclui só quando confirmName bate exatamente com o nome real', async () => {
    supabase = createFakeSupabase({ tenants: [{ id: 'tenant-a', name: 'Tanent 3' }] });
    ({ server, baseUrl } = await startServer('saas_admin'));

    const res = await fetch(`${baseUrl}/api/admin/tenants/tenant-a`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ confirmName: 'Tanent 3' }),
    });
    expect(res.status).toBe(200);
    expect(supabase.__tables.tenants.find((t: any) => t.id === 'tenant-a')).toBeUndefined();
  });

  it('rejeita quando confirmName não bate (nunca apaga por engano)', async () => {
    supabase = createFakeSupabase({ tenants: [{ id: 'tenant-a', name: 'Monique — Pestañas por Monique' }] });
    ({ server, baseUrl } = await startServer('saas_admin'));

    const res = await fetch(`${baseUrl}/api/admin/tenants/tenant-a`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ confirmName: 'monique' }),
    });
    expect(res.status).toBe(400);
    expect(supabase.__tables.tenants.find((t: any) => t.id === 'tenant-a')).toBeDefined();
  });

  it('rejeita sem confirmName nenhum', async () => {
    supabase = createFakeSupabase({ tenants: [{ id: 'tenant-a', name: 'X' }] });
    ({ server, baseUrl } = await startServer('saas_admin'));

    const res = await fetch(`${baseUrl}/api/admin/tenants/tenant-a`, { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) });
    expect(res.status).toBe(400);
  });

  it('404 pra tenant inexistente', async () => {
    supabase = createFakeSupabase({ tenants: [] });
    ({ server, baseUrl } = await startServer('saas_admin'));
    const res = await fetch(`${baseUrl}/api/admin/tenants/nao-existe`, { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ confirmName: 'X' }) });
    expect(res.status).toBe(404);
  });

  it('admin comum (não saas_admin) é rejeitado com 403', async () => {
    supabase = createFakeSupabase({ tenants: [{ id: 'tenant-a', name: 'X' }] });
    ({ server, baseUrl } = await startServer('admin'));
    const res = await fetch(`${baseUrl}/api/admin/tenants/tenant-a`, { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ confirmName: 'X' }) });
    expect(res.status).toBe(403);
  });
});
