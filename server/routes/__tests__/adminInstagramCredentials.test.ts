/**
 * GET/PUT /api/admin/tenants/:id/instagram-credentials — Instagram DM (Fase
 * 1, 15/08/2026). Mesmo padrão de segredo do capi-credentials (ver
 * adminCapiCredentials.test.ts): token nunca volta em texto puro, campo em
 * branco no PUT nunca apaga um token já salvo. Só saas_admin, mesmo nível de
 * sensibilidade de credencial de terceiro que capi-credentials.
 */
import express from 'express';
import type { Server } from 'http';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createAdminRouter } from '../admin';
import { createFakeSupabase } from '../../services/__tests__/fakeSupabase';

const TENANT_ID = 'tenant-ig-1';
const OTHER_TENANT_ID = 'tenant-ig-2';

let server: Server;
let baseUrl: string;
let supabase: ReturnType<typeof createFakeSupabase>;

function makeAuth(role: string) {
  return (req: any, _res: any, next: any) => {
    req.user = { id: 'op-1', tenantId: TENANT_ID, role };
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

beforeEach(() => {
  supabase = createFakeSupabase({
    tenants: [
      { id: TENANT_ID, slug: 'cliente-ig', name: 'Cliente Instagram' },
      { id: OTHER_TENANT_ID, slug: 'outro-cliente', name: 'Outro Cliente' },
    ],
  });
});

afterEach(async () => {
  if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe('GET/PUT /api/admin/tenants/:id/instagram-credentials', () => {
  it('GET devolve null/false quando nunca foi configurado; PUT grava; GET seguinte reflete sem nunca devolver o token em texto puro', async () => {
    ({ server, baseUrl } = await startServer('saas_admin'));

    const getBefore = await fetch(`${baseUrl}/api/admin/tenants/${TENANT_ID}/instagram-credentials`);
    expect(getBefore.status).toBe(200);
    expect(await getBefore.json()).toEqual({ instagramAccountId: null, accessTokenSet: false });

    const put = await fetch(`${baseUrl}/api/admin/tenants/${TENANT_ID}/instagram-credentials`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ instagramAccountId: 'ig-123', accessToken: 'segredo-real' }),
    });
    expect(put.status).toBe(200);

    const getAfter = await fetch(`${baseUrl}/api/admin/tenants/${TENANT_ID}/instagram-credentials`);
    const afterBody = await getAfter.json();
    expect(afterBody).toEqual({ instagramAccountId: 'ig-123', accessTokenSet: true });
    expect(JSON.stringify(afterBody)).not.toContain('segredo-real');
  });

  it('PUT com accessToken em branco/ausente não apaga um token já salvo', async () => {
    ({ server, baseUrl } = await startServer('saas_admin'));
    await fetch(`${baseUrl}/api/admin/tenants/${TENANT_ID}/instagram-credentials`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ instagramAccountId: 'ig-original', accessToken: 'token-original' }),
    });

    const secondPut = await fetch(`${baseUrl}/api/admin/tenants/${TENANT_ID}/instagram-credentials`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ instagramAccountId: 'ig-atualizado' }),
    });
    expect(secondPut.status).toBe(200);

    const row = supabase.__tables['tenant_instagram_credentials'].find((r: any) => r.tenant_id === TENANT_ID);
    expect(row.instagram_account_id).toBe('ig-atualizado');
    expect(row.access_token).toBe('token-original');
  });

  it('PUT sem credencial anterior e sem accessToken novo é rejeitado (token obrigatório na primeira gravação)', async () => {
    ({ server, baseUrl } = await startServer('saas_admin'));
    const res = await fetch(`${baseUrl}/api/admin/tenants/${TENANT_ID}/instagram-credentials`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ instagramAccountId: 'ig-sem-token' }),
    });
    expect(res.status).toBe(400);
  });

  it('isolamento: credencial de um tenant nunca aparece na leitura de outro', async () => {
    ({ server, baseUrl } = await startServer('saas_admin'));
    await fetch(`${baseUrl}/api/admin/tenants/${TENANT_ID}/instagram-credentials`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ instagramAccountId: 'ig-tenant-1', accessToken: 'token-tenant-1' }),
    });

    const otherGet = await fetch(`${baseUrl}/api/admin/tenants/${OTHER_TENANT_ID}/instagram-credentials`);
    expect(await otherGet.json()).toEqual({ instagramAccountId: null, accessTokenSet: false });
  });

  it('PUT em tenant inexistente devolve 404', async () => {
    ({ server, baseUrl } = await startServer('saas_admin'));
    const res = await fetch(`${baseUrl}/api/admin/tenants/tenant-fantasma/instagram-credentials`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ instagramAccountId: 'ig-x', accessToken: 'token-x' }),
    });
    expect(res.status).toBe(404);
  });

  it('rejeita accessToken que não é string nem ausente', async () => {
    ({ server, baseUrl } = await startServer('saas_admin'));
    const res = await fetch(`${baseUrl}/api/admin/tenants/${TENANT_ID}/instagram-credentials`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accessToken: 42 }),
    });
    expect(res.status).toBe(400);
  });

  it('admin comum (não saas_admin) é rejeitado com 403 tanto no GET quanto no PUT', async () => {
    ({ server, baseUrl } = await startServer('admin'));

    const getRes = await fetch(`${baseUrl}/api/admin/tenants/${TENANT_ID}/instagram-credentials`);
    expect(getRes.status).toBe(403);

    const putRes = await fetch(`${baseUrl}/api/admin/tenants/${TENANT_ID}/instagram-credentials`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ instagramAccountId: 'ig-x' }),
    });
    expect(putRes.status).toBe(403);
  });
});
