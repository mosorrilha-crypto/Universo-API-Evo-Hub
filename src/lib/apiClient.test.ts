import { afterEach, describe, expect, it } from 'vitest';
import { getTenantOverride, setTenantOverride } from './apiClient';

const storage = new Map<string, string>();
Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
  },
});

describe('apiClient tenant override', () => {
  afterEach(() => {
    setTenantOverride(null);
    storage.clear();
  });

  it('descarta IDs fictícios ou legados que não são UUIDs', () => {
    setTenantOverride('tenant_004');
    expect(getTenantOverride()).toBeNull();

    setTenantOverride('tenant-de-outra-empresa');
    expect(getTenantOverride()).toBeNull();
  });

  it('mantém um UUID de tenant válido e persiste a seleção', () => {
    const tenantId = '11111111-1111-4111-8111-111111111111';
    setTenantOverride(tenantId);
    expect(getTenantOverride()).toBe(tenantId);
    expect(localStorage.getItem('saas_active_tenant_override')).toBe(tenantId);
  });

  it('remove a seleção persistida ao limpar o override', () => {
    setTenantOverride('11111111-1111-4111-8111-111111111111');
    setTenantOverride(null);
    expect(localStorage.getItem('saas_active_tenant_override')).toBeNull();
  });

  it('aceita o UUID canônico legado do Clic mesmo sem variante RFC 4122', () => {
    const tenantId = '11111111-1111-1111-1111-111111111111';
    setTenantOverride(tenantId);
    expect(getTenantOverride()).toBe(tenantId);
  });
});
