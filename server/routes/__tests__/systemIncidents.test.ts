import express from 'express';
import type { Server } from 'http';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createConversationsRouter } from '../conversations';
import { initDb } from '../../services/db';
import { createFakeSupabase } from '../../services/__tests__/fakeSupabase';
import { reportSystemIncident } from '../../services/systemIncidentStore';

const OWN_TENANT_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_TENANT_ID = '22222222-2222-4222-8222-222222222222';
let currentRole = 'admin';
let server: Server;
let baseUrl: string;

function fakeAuthenticateToken(req: any, _res: any, next: any) {
  req.user = { id: 'admin-1', tenantId: OWN_TENANT_ID, role: currentRole };
  next();
}

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use(createConversationsRouter({ authenticateToken: fakeAuthenticateToken as any, metaAccessToken: 'test-token', jwtSecret: 'test-secret', metaPhoneNumberId: 'test-phone' }));
  await new Promise<void>((resolve) => { server = app.listen(0, () => resolve()); });
  const address = server.address();
  baseUrl = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`;
});

beforeEach(() => {
  initDb(createFakeSupabase({}) as any);
  currentRole = 'admin';
});

afterAll(() => server.close());

describe('rotas /api/system-incidents', () => {
  it('permite ao administrador ver e revisar somente os incidentes do tenant autenticado', async () => {
    const own = await reportSystemIncident({ tenantId: OWN_TENANT_ID, sourceKey: 'system:runtime:sync:error', category: 'runtime', severity: 'medium', title: 'Incidente próprio', suggestedAction: 'Revisar.' });
    await reportSystemIncident({ tenantId: OTHER_TENANT_ID, sourceKey: 'system:runtime:sync:error', category: 'runtime', severity: 'medium', title: 'Incidente de outro tenant', suggestedAction: 'Revisar.' });

    const list = await fetch(`${baseUrl}/api/system-incidents`, { headers: { 'X-Tenant-Id': OTHER_TENANT_ID } });
    const listed = await list.json();
    expect(list.status).toBe(200);
    expect(listed.incidents).toHaveLength(1);
    expect(listed.incidents[0].id).toBe(own.id);

    const reviewed = await fetch(`${baseUrl}/api/system-incidents/${own.id}/review`, { method: 'POST' });
    expect(reviewed.status).toBe(200);
    expect((await reviewed.json()).incident.status).toBe('reviewed');
  });

  it('bloqueia operadores mesmo quando conhecem a URL administrativa', async () => {
    currentRole = 'operator';
    const response = await fetch(`${baseUrl}/api/system-incidents`);
    expect(response.status).toBe(403);
  });
});
