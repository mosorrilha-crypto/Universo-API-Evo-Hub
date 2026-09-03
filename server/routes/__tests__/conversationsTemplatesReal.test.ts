/**
 * Achado real de auditoria (Central de Operação por WhatsApp): a rota
 * GET /api/conversations/:phone/templates devolvia uma lista FICTÍCIA
 * hardcoded (mesma pra qualquer tenant) — agora busca de verdade na conta
 * WhatsApp Business (WABA) real do tenant, nunca inventa nada.
 */
import express from 'express';
import type { Server } from 'http';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { initDb } from '../../services/db';
import { createFakeSupabase } from '../../services/__tests__/fakeSupabase';

const listApprovedMetaMessageTemplates = vi.fn(async (_wabaId?: string, _accessToken?: string) => [
  { id: 'tpl-real-1', name: 'lembrete_consulta_real', category: 'UTILITY', language: 'pt_BR', bodyText: 'Olá {{1}}', variableExamples: ['Maria'] },
]);

vi.mock('../../services/metaSend', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../services/metaSend')>();
  return { ...actual, listApprovedMetaMessageTemplates };
});

const { createConversationsRouter } = await import('../conversations');

const TENANT_A = 'tenant-a';
const TENANT_B = 'tenant-b';

let server: Server;
let baseUrl: string;
let supabase: ReturnType<typeof createFakeSupabase>;

function fakeAuthenticateToken(req: any, _res: any, next: any) {
  req.user = { id: 'op-1', tenantId: TENANT_A, role: 'admin' };
  next();
}

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use(
    createConversationsRouter({
      authenticateToken: fakeAuthenticateToken as any,
      metaAccessToken: 'shared-tok',
      jwtSecret: 'test-secret',
      metaPhoneNumberId: 'shared-pn',
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
  listApprovedMetaMessageTemplates.mockClear();
  supabase = createFakeSupabase({});
  initDb(supabase);
});

describe('GET /api/conversations/:phone/templates', () => {
  it('sem tenant_meta_credentials cadastrada: devolve lista vazia com o motivo, sem chamar a Meta', async () => {
    const res = await fetch(`${baseUrl}/api/conversations/595981111111/templates`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ templates: [], reason: 'waba_not_configured' });
    expect(listApprovedMetaMessageTemplates).not.toHaveBeenCalled();
  });

  it('com waba_id cadastrado: busca os templates reais e devolve exatamente o que a Meta aprovou', async () => {
    supabase.__tables['tenant_meta_credentials'] = [
      { tenant_id: TENANT_A, access_token: 'token-real-tenant-a', waba_id: 'waba-tenant-a', phone_number_id: 'pn-a' },
    ];

    const res = await fetch(`${baseUrl}/api/conversations/595981111111/templates`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.templates).toHaveLength(1);
    expect(body.templates[0].name).toBe('lembrete_consulta_real');
    expect(listApprovedMetaMessageTemplates).toHaveBeenCalledWith('waba-tenant-a', 'token-real-tenant-a');
  });

  it('isolamento: o waba_id/token usado é sempre o do tenant do JWT, nunca de outro tenant', async () => {
    supabase.__tables['tenant_meta_credentials'] = [
      { tenant_id: TENANT_A, access_token: 'token-tenant-a', waba_id: 'waba-tenant-a', phone_number_id: 'pn-a' },
      { tenant_id: TENANT_B, access_token: 'token-tenant-b', waba_id: 'waba-tenant-b', phone_number_id: 'pn-b' },
    ];

    await fetch(`${baseUrl}/api/conversations/595981111111/templates`);
    expect(listApprovedMetaMessageTemplates).toHaveBeenCalledWith('waba-tenant-a', 'token-tenant-a');
    expect(listApprovedMetaMessageTemplates).not.toHaveBeenCalledWith('waba-tenant-b', 'token-tenant-b');
  });

  it('falha ao buscar na Meta: devolve lista vazia com status 502, nunca dado inventado', async () => {
    supabase.__tables['tenant_meta_credentials'] = [
      { tenant_id: TENANT_A, access_token: 'token-real', waba_id: 'waba-real', phone_number_id: 'pn-a' },
    ];
    listApprovedMetaMessageTemplates.mockRejectedValueOnce(new Error('Invalid OAuth access token.'));

    const res = await fetch(`${baseUrl}/api/conversations/595981111111/templates`);
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ templates: [], error: 'Invalid OAuth access token.' });
  });
});
