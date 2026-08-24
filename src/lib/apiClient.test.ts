import { afterEach, describe, expect, it } from 'vitest';
import { getTenantOverride, setTenantOverride } from './apiClient';

describe('apiClient tenant override', () => {
  afterEach(() => setTenantOverride(null));

  it('descarta IDs fictícios ou legados que não são UUIDs', () => {
    setTenantOverride('tenant_004');
    expect(getTenantOverride()).toBeNull();

    setTenantOverride('tenant-de-outra-empresa');
    expect(getTenantOverride()).toBeNull();
  });

  it('mantém um UUID de tenant válido', () => {
    const tenantId = '11111111-1111-4111-8111-111111111111';
    setTenantOverride(tenantId);
    expect(getTenantOverride()).toBe(tenantId);
  });

  it('aceita o UUID canônico legado do Clic mesmo sem variante RFC 4122', () => {
    const tenantId = '11111111-1111-1111-1111-111111111111';
    setTenantOverride(tenantId);
    expect(getTenantOverride()).toBe(tenantId);
  });
});
