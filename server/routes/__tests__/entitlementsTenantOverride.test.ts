import express from 'express';
import type { Server } from 'node:http';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../services/featureEntitlementService', () => ({
  getTenantEntitlements: vi.fn(async () => ({
    tenantId: 'tenant-selected-by-saas-admin',
    subscription: null,
    entitlements: [],
  })),
}));

vi.mock('../../middleware/rbac', () => ({
  resolveTenantId: vi.fn(),
}));

import { createEntitlementsRouter } from '../entitlements';
import { getTenantEntitlements } from '../../services/featureEntitlementService';
import { resolveTenantId } from '../../middleware/rbac';

let server: Server;
let baseUrl: string;

function authenticateAsSaasAdmin(req: any, _res: any, next: any) {
  req.user = {
    id: 'saas-admin-1',
    tenantId: 'tenant-of-login',
    role: 'saas_admin',
  };
  next();
}

beforeAll(async () => {
  const app = express();
  app.use(createEntitlementsRouter({ authenticateToken: authenticateAsSaasAdmin }));
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
  vi.clearAllMocks();
});

describe('GET /api/me/entitlements', () => {
  it('aplica o override validado do saas_admin antes de ler as capacidades', async () => {
    const response = await fetch(`${baseUrl}/api/me/entitlements`, {
      headers: { 'X-Tenant-Id': '8a786c2a-aa8c-4c2a-bc12-d50058c598ce' },
    });

    expect(response.status).toBe(200);
    expect(resolveTenantId).toHaveBeenCalledOnce();
    expect(getTenantEntitlements).toHaveBeenCalledOnce();
    await expect(response.json()).resolves.toMatchObject({
      tenantId: 'tenant-selected-by-saas-admin',
    });
  });
});
