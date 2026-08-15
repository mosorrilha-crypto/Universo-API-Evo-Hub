/**
 * Instagram DM (Fase 1, 15/08/2026) — mesma regra de segurança do Bloco 2.B/
 * Epic 4.6 (ver tenantResolver.test.ts): canal desconhecido nunca cai
 * silenciosamente em tenant nenhum. Diferente da Meta/Evolution, não existe
 * fallback pra tenant legado aqui — é um canal novo, sem histórico anterior.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { initDb } from '../db';
import { createFakeSupabase } from './fakeSupabase';
import { resolveTenantByInstagramAccountId } from '../tenantResolver';
import { LEGACY_DEFAULT_TENANT_ID } from '../tenantContext';

const TENANT_D = '44444444-4444-4444-4444-444444444444';

beforeEach(() => {
  initDb(
    createFakeSupabase({
      tenant_instagram_credentials: [{ tenant_id: TENANT_D, instagram_account_id: 'ig-conta-tenant-d', access_token: 'token-d' }],
    })
  );
});

describe('resolveTenantByInstagramAccountId', () => {
  it('resolve pro tenant cadastrado quando a conta Instagram bate', async () => {
    const resolved = await resolveTenantByInstagramAccountId('ig-conta-tenant-d');
    expect(resolved.tenantId).toBe(TENANT_D);
    expect(resolved.provider).toBe('instagram');
    expect(resolved.instagramAccountId).toBe('ig-conta-tenant-d');
    expect(resolved.instagramAccessToken).toBe('token-d');
    expect(resolved.unknownChannel).toBeFalsy();
  });

  it('NUNCA cai em nenhum tenant legado quando a conta é desconhecida — retorna unknownChannel', async () => {
    const resolved = await resolveTenantByInstagramAccountId('ig-conta-totalmente-desconhecida');
    expect(resolved.unknownChannel).toBe(true);
    expect(resolved.tenantId).not.toBe(LEGACY_DEFAULT_TENANT_ID);
    expect(resolved.tenantId).toBe('');
  });

  it('descarta como canal desconhecido quando não há ID de conta no payload', async () => {
    const resolved = await resolveTenantByInstagramAccountId(undefined);
    expect(resolved.unknownChannel).toBe(true);
  });
});
