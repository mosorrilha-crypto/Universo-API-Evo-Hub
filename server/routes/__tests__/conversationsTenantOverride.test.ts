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
 */
import express from 'express';
import type { Server } from 'http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createConversationsRouter } from '../conversations';
import { initDb } from '../../services/db';
import { createFakeSupabase } from '../../services/__tests__/fakeSupabase';

const OWN_TENANT_ID = 'tenant-proprio-do-login';
const OTHER_TENANT_ID = 'tenant-de-outra-empresa';

let server: Server;
let baseUrl: string;
let supabase: ReturnType<typeof createFakeSupabase>;
let currentRole = 'saas_admin';

function fakeAuthenticateToken(req: any, _res: any, next: any) {
  req.user = { id: 'op-1', tenantId: OWN_TENANT_ID, role: currentRole };
  next();
}

beforeAll(async () => {
  supabase = createFakeSupabase({});
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
    server = app.listen(0, resolve);
  });
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  baseUrl = `http://127.0.0.1:${port}`;
});

afterAll(() => {
  server.close();
});

describe('resolveTenantId via header X-Tenant-Id (POST/GET /api/knowledge-base)', () => {
  it('saas_admin com X-Tenant-Id: grava/lê no tenant apontado pelo header, não no do próprio login', async () => {
    currentRole = 'saas_admin';
    const putRes = await fetch(`${baseUrl}/api/knowledge-base`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Tenant-Id': OTHER_TENANT_ID },
      body: JSON.stringify({ knowledgeBase: { companyName: 'Empresa do outro tenant' } }),
    });
    expect(putRes.status).toBe(200);

    const rows = supabase.__tables.knowledge_base || [];
    expect(rows).toHaveLength(1);
    expect(rows[0].tenant_id).toBe(OTHER_TENANT_ID);
    expect(rows[0].tenant_id).not.toBe(OWN_TENANT_ID);

    const getRes = await fetch(`${baseUrl}/api/knowledge-base`, { headers: { 'X-Tenant-Id': OTHER_TENANT_ID } });
    const data = await getRes.json();
    expect(data.knowledgeBase.companyName).toBe('Empresa do outro tenant');
  });

  it('saas_admin SEM X-Tenant-Id: continua caindo no tenant do próprio login, comportamento de sempre', async () => {
    currentRole = 'saas_admin';
    const res = await fetch(`${baseUrl}/api/knowledge-base`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ knowledgeBase: { companyName: 'Empresa do próprio saas_admin' } }),
    });
    expect(res.status).toBe(200);

    const row = (supabase.__tables.knowledge_base || []).find((r: any) => r.tenant_id === OWN_TENANT_ID);
    expect(row?.data?.companyName).toBe('Empresa do próprio saas_admin');
  });

  it('achado real corrigido: admin comum (não saas_admin) mandando X-Tenant-Id é IGNORADO — nunca consegue apontar pra outro tenant', async () => {
    currentRole = 'admin';
    const res = await fetch(`${baseUrl}/api/knowledge-base`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Tenant-Id': OTHER_TENANT_ID },
      body: JSON.stringify({ knowledgeBase: { companyName: 'Tentativa de admin comum apontar pra outro tenant' } }),
    });
    expect(res.status).toBe(200);

    // Foi pro tenant do PRÓPRIO login, nunca pro tenant do header.
    const ownRow = (supabase.__tables.knowledge_base || []).find((r: any) => r.tenant_id === OWN_TENANT_ID);
    expect(ownRow?.data?.companyName).toBe('Tentativa de admin comum apontar pra outro tenant');

    // O tenant do header NÃO foi sobrescrito por essa tentativa (continua
    // com o valor gravado no teste anterior pelo saas_admin de verdade).
    const otherRow = (supabase.__tables.knowledge_base || []).find((r: any) => r.tenant_id === OTHER_TENANT_ID);
    expect(otherRow?.data?.companyName).toBe('Empresa do outro tenant');
  });

  it('achado real corrigido: manager mandando X-Tenant-Id também é ignorado', async () => {
    currentRole = 'manager';
    const res = await fetch(`${baseUrl}/api/knowledge-base`, { headers: { 'X-Tenant-Id': OTHER_TENANT_ID } });
    expect(res.status).toBe(200);
    const data = await res.json();
    // GET sem gravação prévia no tenant do próprio login desse teste
    // específico (OWN_TENANT_ID já tem dado de outro teste) — o importante
    // aqui é só confirmar que NÃO devolveu o conteúdo do OTHER_TENANT_ID.
    expect(data.knowledgeBase?.companyName).not.toBe('Empresa do outro tenant');
  });
});
