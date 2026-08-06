/**
 * Regressão do PR #39: phone_number_id desconhecido nunca deve mais cair
 * silenciosamente no tenant legado (risco de vazamento cross-tenant — ver
 * docs/AGENTE-VERTICAL-ARQUITETURA.md, seção 5).
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { initDb } from '../db';
import { createFakeSupabase } from './fakeSupabase';
import { resolveTenantByPhoneNumberId } from '../tenantResolver';
import { LEGACY_DEFAULT_TENANT_ID } from '../tenantContext';

const SHARED_PHONE_NUMBER_ID = 'shared-number-123';
const TENANT_B = '22222222-2222-2222-2222-222222222222';

beforeEach(() => {
  initDb(
    createFakeSupabase({
      tenant_meta_credentials: [{ tenant_id: TENANT_B, phone_number_id: 'cadastrado-tenant-b', access_token: 'token-b' }],
    })
  );
});

describe('resolveTenantByPhoneNumberId', () => {
  it('resolve pro tenant cadastrado quando o phone_number_id bate', async () => {
    const resolved = await resolveTenantByPhoneNumberId('cadastrado-tenant-b', { metaPhoneNumberId: SHARED_PHONE_NUMBER_ID });
    expect(resolved.tenantId).toBe(TENANT_B);
    expect(resolved.unknownChannel).toBeFalsy();
  });

  it('cai no tenant legado quando o número é exatamente o compartilhado configurado', async () => {
    const resolved = await resolveTenantByPhoneNumberId(SHARED_PHONE_NUMBER_ID, { metaPhoneNumberId: SHARED_PHONE_NUMBER_ID });
    expect(resolved.tenantId).toBe(LEGACY_DEFAULT_TENANT_ID);
    expect(resolved.unknownChannel).toBeFalsy();
  });

  it('cai no tenant legado quando não há phone_number_id no payload (provider sem essa metadata)', async () => {
    const resolved = await resolveTenantByPhoneNumberId(undefined, { metaPhoneNumberId: SHARED_PHONE_NUMBER_ID });
    expect(resolved.tenantId).toBe(LEGACY_DEFAULT_TENANT_ID);
  });

  it('NUNCA cai no tenant legado quando o número é desconhecido — retorna unknownChannel', async () => {
    const resolved = await resolveTenantByPhoneNumberId('numero-totalmente-desconhecido', { metaPhoneNumberId: SHARED_PHONE_NUMBER_ID });
    expect(resolved.unknownChannel).toBe(true);
    expect(resolved.tenantId).not.toBe(LEGACY_DEFAULT_TENANT_ID);
  });
});
