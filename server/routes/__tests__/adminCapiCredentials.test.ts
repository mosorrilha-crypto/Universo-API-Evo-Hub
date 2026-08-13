/**
 * GET/PUT /api/admin/tenants/:id/capi-credentials — Achado numa auditoria:
 * o disparo automático de CAPI ("Schedule"/"Purchase", metaCapiService.ts)
 * lê tenant_meta_credentials.capi_dataset_id/capi_access_token/capi_page_id,
 * mas nenhuma rota nem tela gravava essas colunas — getTenantCapiCredentials
 * sempre devolvia null e o operador precisava clicar manualmente em "Central
 * & Disparo Meta CAPI" pra todo lead, inclusive os que vieram de anúncio.
 * Só saas_admin — mesma credencial vale pra todos os operadores do tenant.
 */
import express from 'express';
import type { Server } from 'http';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createAdminRouter } from '../admin';
import { createFakeSupabase } from '../../services/__tests__/fakeSupabase';

const TENANT_ID = 'tenant-capi-1';
const OTHER_TENANT_ID = 'tenant-capi-2';

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
      { id: TENANT_ID, slug: 'cliente-capi', name: 'Cliente CAPI' },
      { id: OTHER_TENANT_ID, slug: 'outro-cliente', name: 'Outro Cliente' },
    ],
  });
});

afterEach(async () => {
  if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe('GET/PUT /api/admin/tenants/:id/capi-credentials', () => {
  it('GET devolve tudo null/false quando nunca foi configurado; PUT grava; GET seguinte reflete sem nunca devolver o token em texto puro', async () => {
    ({ server, baseUrl } = await startServer('saas_admin'));

    const getBefore = await fetch(`${baseUrl}/api/admin/tenants/${TENANT_ID}/capi-credentials`);
    expect(getBefore.status).toBe(200);
    expect(await getBefore.json()).toEqual({ capiDatasetId: null, capiPageId: null, capiAccessTokenSet: false });

    const put = await fetch(`${baseUrl}/api/admin/tenants/${TENANT_ID}/capi-credentials`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ capiDatasetId: 'ds-123', capiPageId: 'page-456', capiAccessToken: 'segredo-real' }),
    });
    expect(put.status).toBe(200);

    const getAfter = await fetch(`${baseUrl}/api/admin/tenants/${TENANT_ID}/capi-credentials`);
    const afterBody = await getAfter.json();
    expect(afterBody).toEqual({ capiDatasetId: 'ds-123', capiPageId: 'page-456', capiAccessTokenSet: true });
    expect(JSON.stringify(afterBody)).not.toContain('segredo-real');
  });

  it('PUT com capiAccessToken em branco/ausente não apaga um token já salvo (só datasetId/pageId são substituídos)', async () => {
    ({ server, baseUrl } = await startServer('saas_admin'));
    await fetch(`${baseUrl}/api/admin/tenants/${TENANT_ID}/capi-credentials`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ capiDatasetId: 'ds-original', capiPageId: 'page-original', capiAccessToken: 'token-original' }),
    });

    const secondPut = await fetch(`${baseUrl}/api/admin/tenants/${TENANT_ID}/capi-credentials`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ capiDatasetId: 'ds-atualizado', capiPageId: 'page-original' }),
    });
    expect(secondPut.status).toBe(200);

    const row = supabase.__tables['tenant_meta_credentials'].find((r: any) => r.tenant_id === TENANT_ID);
    expect(row.capi_dataset_id).toBe('ds-atualizado');
    expect(row.capi_access_token).toBe('token-original');

    const getAfter = await fetch(`${baseUrl}/api/admin/tenants/${TENANT_ID}/capi-credentials`);
    expect(await getAfter.json()).toEqual({ capiDatasetId: 'ds-atualizado', capiPageId: 'page-original', capiAccessTokenSet: true });
  });

  it('isolamento: credencial de um tenant nunca aparece na leitura de outro', async () => {
    ({ server, baseUrl } = await startServer('saas_admin'));
    await fetch(`${baseUrl}/api/admin/tenants/${TENANT_ID}/capi-credentials`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ capiDatasetId: 'ds-tenant-1', capiPageId: 'page-tenant-1', capiAccessToken: 'token-tenant-1' }),
    });

    const otherGet = await fetch(`${baseUrl}/api/admin/tenants/${OTHER_TENANT_ID}/capi-credentials`);
    expect(await otherGet.json()).toEqual({ capiDatasetId: null, capiPageId: null, capiAccessTokenSet: false });
  });

  it('PUT em tenant inexistente devolve 404', async () => {
    ({ server, baseUrl } = await startServer('saas_admin'));
    const res = await fetch(`${baseUrl}/api/admin/tenants/tenant-fantasma/capi-credentials`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ capiDatasetId: 'ds-x' }),
    });
    expect(res.status).toBe(404);
  });

  it('rejeita capiAccessToken que não é string nem ausente', async () => {
    ({ server, baseUrl } = await startServer('saas_admin'));
    const res = await fetch(`${baseUrl}/api/admin/tenants/${TENANT_ID}/capi-credentials`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ capiAccessToken: 42 }),
    });
    expect(res.status).toBe(400);
  });

  it('admin comum (não saas_admin) é rejeitado com 403 tanto no GET quanto no PUT', async () => {
    ({ server, baseUrl } = await startServer('admin'));

    const getRes = await fetch(`${baseUrl}/api/admin/tenants/${TENANT_ID}/capi-credentials`);
    expect(getRes.status).toBe(403);

    const putRes = await fetch(`${baseUrl}/api/admin/tenants/${TENANT_ID}/capi-credentials`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ capiDatasetId: 'ds-x' }),
    });
    expect(putRes.status).toBe(403);
  });
});
