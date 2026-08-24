import { describe, expect, it } from 'vitest';
import { resolveTenantId } from '../rbac';

const OWN_TENANT_ID = '8a786c2a-aa8c-4c2a-bc12-d50058c598ce';
const CLIC_TENANT_ID = '11111111-1111-1111-1111-111111111111';

function request(role: string, override?: string) {
  return {
    user: { role, tenantId: OWN_TENANT_ID },
    headers: override === undefined ? {} : { 'x-tenant-id': override },
  } as any;
}

describe('resolveTenantId', () => {
  it('aceita o UUID canônico legado do Clic para saas_admin', () => {
    expect(resolveTenantId(request('saas_admin', CLIC_TENANT_ID))).toBe(CLIC_TENANT_ID);
  });

  it('mantém IDs fictícios fora do formato UUID no tenant do JWT', () => {
    expect(resolveTenantId(request('saas_admin', 'tenant_004'))).toBe(OWN_TENANT_ID);
  });

  it('ignora override para papéis que não são saas_admin', () => {
    expect(resolveTenantId(request('admin', CLIC_TENANT_ID))).toBe(OWN_TENANT_ID);
  });
});
