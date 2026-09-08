/**
 * Incidente real em produção (15/08/2026): o seletor de tenant do painel
 * (Header.tsx, só visível pra saas_admin) sempre pareceu mudar pra qual
 * tenant as ações se aplicavam, mas nunca mudou de verdade — toda rota
 * resolvia o tenant só pelo JWT, fixo desde o login. Um saas_admin trocou
 * pra "Clic Piscinas" no seletor, salvou a Mensagem de Primeiro Contato lá
 * (achando que era pra esse tenant) e a gravação foi silenciosamente pro
 * tenant do PRÓPRIO login — um cliente real de outro tenant chegou a
 * receber o conteúdo errado (issue real, ver server/middleware/rbac.ts,
 * resolveTenantId).
 *
 * Este arquivo prova a correção: X-Tenant-Id só tem efeito pra saas_admin,
 * e nunca pra qualquer outro papel (mesmo tentando).
 *
 * TASK-0327 — a rota original usada como veículo aqui (POST /api/knowledge-base,
 * blob legado) foi eliminada; o vídeo passou a ser POST/GET /api/business-hours
 * (tabela `tenants`, mesmo tenantOf(req)/resolveTenantId sob teste), que exige
 * uma linha pré-existente por tenant (update silencioso sem match, igual ao
 * Postgres real — ver setTenantBusinessHours).
 */
import express from 'express';
import type { Server } from 'http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createConversationsRouter } from '../conversations';
import { initDb } from '../../services/db';
import { createFakeSupabase } from '../../services/__tests__/fakeSupabase';

const OWN_TENANT_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_TENANT_ID = '22222222-2222-4222-8222-222222222222';

let server: Server;
let baseUrl: string;
let supabase: ReturnType<typeof createFakeSupabase>;
let currentRole = 'saas_admin';

function fakeAuthenticateToken(req: any, _res: any, next: any) {
  req.user = { id: 'op-1', tenantId: OWN_TENANT_ID, role: currentRole };
  next();
}

beforeAll(async () => {
  supabase = createFakeSupabase({
    tenants: [
      { id: OWN_TENANT_ID, business_hours: null },
      { id: OTHER_TENANT_ID, business_hours: null },
    ],
  });
  initDb(supabase);

  const app = express();
  app.use(express.json());
  app.use(
    createConversationsRouter({
      authenticateToken: fakeAuthenticateToken as any,
      metaAccessToken: 'tok',
      jwtSecret: 'test-secret',
      metaPhoneNumberId: 'pn',
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

function tenantRow(tenantId: string) {
  return (supabase.__tables.tenants || []).find((r: any) => r.id === tenantId);
}

describe('resolveTenantId via header X-Tenant-Id (POST/GET /api/business-hours)', () => {
  it('saas_admin com X-Tenant-Id: grava/lê no tenant apontado pelo header, não no do próprio login', async () => {
    currentRole = 'saas_admin';
    const putRes = await fetch(`${baseUrl}/api/business-hours`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Tenant-Id': OTHER_TENANT_ID },
      body: JSON.stringify({ businessHours: { '1': { open: '08:00', close: '18:00' } } }),
    });
    expect(putRes.status).toBe(200);

    expect(tenantRow(OTHER_TENANT_ID)?.business_hours).toEqual({ '1': { open: '08:00', close: '18:00' } });
    expect(tenantRow(OWN_TENANT_ID)?.business_hours).not.toEqual({ '1': { open: '08:00', close: '18:00' } });

    const getRes = await fetch(`${baseUrl}/api/business-hours`, { headers: { 'X-Tenant-Id': OTHER_TENANT_ID } });
    const data = await getRes.json();
    expect(data.businessHours).toEqual({ '1': { open: '08:00', close: '18:00' } });
  });

  it('saas_admin SEM X-Tenant-Id: continua caindo no tenant do próprio login, comportamento de sempre', async () => {
    currentRole = 'saas_admin';
    const res = await fetch(`${baseUrl}/api/business-hours`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ businessHours: { '2': { open: '09:00', close: '17:00' } } }),
    });
    expect(res.status).toBe(200);

    expect(tenantRow(OWN_TENANT_ID)?.business_hours).toEqual({ '2': { open: '09:00', close: '17:00' } });
  });

  it('achado real corrigido: admin comum (não saas_admin) mandando X-Tenant-Id é IGNORADO — nunca consegue apontar pra outro tenant', async () => {
    currentRole = 'admin';
    const res = await fetch(`${baseUrl}/api/business-hours`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Tenant-Id': OTHER_TENANT_ID },
      body: JSON.stringify({ businessHours: { '3': { open: '10:00', close: '16:00' } } }),
    });
    expect(res.status).toBe(200);

    // Foi pro tenant do PRÓPRIO login, nunca pro tenant do header.
    expect(tenantRow(OWN_TENANT_ID)?.business_hours).toEqual({ '3': { open: '10:00', close: '16:00' } });

    // O tenant do header NÃO foi sobrescrito por essa tentativa (continua
    // com o valor gravado no teste anterior pelo saas_admin de verdade).
    expect(tenantRow(OTHER_TENANT_ID)?.business_hours).toEqual({ '1': { open: '08:00', close: '18:00' } });
  });

  it('saas_admin com X-Tenant-Id legado/fictício ignora o override e preserva o tenant do JWT', async () => {
    currentRole = 'saas_admin';
    const res = await fetch(`${baseUrl}/api/business-hours`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Tenant-Id': 'tenant_004' },
      body: JSON.stringify({ businessHours: { '4': { open: '11:00', close: '15:00' } } }),
    });
    expect(res.status).toBe(200);

    expect(tenantRow(OWN_TENANT_ID)?.business_hours).toEqual({ '4': { open: '11:00', close: '15:00' } });
    expect(tenantRow('tenant_004')).toBeUndefined();
  });

  it('achado real corrigido: manager mandando X-Tenant-Id também é ignorado', async () => {
    currentRole = 'manager';
    const res = await fetch(`${baseUrl}/api/business-hours`, { headers: { 'X-Tenant-Id': OTHER_TENANT_ID } });
    expect(res.status).toBe(200);
    const data = await res.json();
    // GET sem gravação prévia no tenant do próprio login desse teste
    // específico (OWN_TENANT_ID já tem dado de outro teste) — o importante
    // aqui é só confirmar que NÃO devolveu o conteúdo do OTHER_TENANT_ID.
    expect(data.businessHours).not.toEqual({ '1': { open: '08:00', close: '18:00' } });
  });
});
