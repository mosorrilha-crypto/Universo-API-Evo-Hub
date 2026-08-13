/**
 * GET /api/admin/tenants — achado numa auditoria (13/08/2026): o painel
 * "Tenants & Conexões" mostrava "WhatsApp Conectado" fixo pra todo tenant
 * (dado de exemplo hardcoded no frontend), sem checar credencial real
 * nenhuma. Este campo novo (`whatsappConnected`) reflete se o tenant tem uma
 * credencial Meta com phone_number_id real OU uma instância Evolution
 * provisionada — as duas formas reais de conexão hoje.
 */
import express from 'express';
import type { Server } from 'http';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createAdminRouter } from '../admin';
import { createFakeSupabase } from '../../services/__tests__/fakeSupabase';

let server: Server;
let baseUrl: string;
let supabase: ReturnType<typeof createFakeSupabase>;

function makeAuth(role: string) {
  return (req: any, _res: any, next: any) => {
    req.user = { id: 'op-1', tenantId: 'tenant-meta', role };
    next();
  };
}

function startServer(role: string) {
  const app = express();
  app.use(express.json());
  app.use(
    createAdminRouter({
      authenticateToken: makeAuth(role) as any,
      supabase: supabase as any,
      publicBaseUrl: 'https://universo.example.com',
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

afterEach(async () => {
  if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe('GET /api/admin/tenants', () => {
  it('marca whatsappConnected=true só pra tenant com phone_number_id real (Meta) ou instância Evolution — nunca fixo', async () => {
    supabase = createFakeSupabase({
      tenants: [
        { id: 'tenant-meta', name: 'Conectado via Meta', slug: 'meta-co' },
        { id: 'tenant-evo', name: 'Conectado via Evolution', slug: 'evo-co' },
        { id: 'tenant-none', name: 'Sem conexão', slug: 'sem-conexao' },
        { id: 'tenant-empty-cred', name: 'Linha de credencial sem telefone', slug: 'linha-vazia' },
      ],
      tenant_meta_credentials: [
        { tenant_id: 'tenant-meta', phone_number_id: '5511999998888' },
        { tenant_id: 'tenant-empty-cred', phone_number_id: null },
      ],
      tenant_evolution_credentials: [{ tenant_id: 'tenant-evo', instance_name: 'evo-co_main' }],
    });
    ({ server, baseUrl } = await startServer('saas_admin'));

    const res = await fetch(`${baseUrl}/api/admin/tenants`);
    expect(res.status).toBe(200);
    const body = await res.json();
    const byId = Object.fromEntries(body.tenants.map((t: any) => [t.id, t.whatsappConnected]));
    expect(byId).toEqual({
      'tenant-meta': true,
      'tenant-evo': true,
      'tenant-none': false,
      'tenant-empty-cred': false,
    });
  });

  it('admin comum (não saas_admin) é rejeitado com 403', async () => {
    supabase = createFakeSupabase({ tenants: [{ id: 'tenant-meta', name: 'X', slug: 'x' }] });
    ({ server, baseUrl } = await startServer('admin'));
    const res = await fetch(`${baseUrl}/api/admin/tenants`);
    expect(res.status).toBe(403);
  });
});
