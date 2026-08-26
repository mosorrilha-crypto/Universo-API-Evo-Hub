import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../db', () => ({
  getDb: vi.fn(),
  getPlatformDb: vi.fn(),
}));

vi.mock('../tenantDbContext', () => ({
  getTenantDbContext: vi.fn(),
}));

import { getDb, getPlatformDb } from '../db';
import { getTenantDbContext } from '../tenantDbContext';
import { getTenantEntitlements } from '../featureEntitlementService';

const getDbMock = vi.mocked(getDb);
const getPlatformDbMock = vi.mocked(getPlatformDb);
const getTenantDbContextMock = vi.mocked(getTenantDbContext);

function query(data: unknown) {
  const chain: any = {
    select: () => chain,
    eq: () => chain,
    in: () => chain,
    is: () => chain,
    order: () => chain,
    limit: () => chain,
    maybeSingle: async () => ({ data, error: null }),
    then: (resolve: (value: { data: unknown; error: null }) => unknown) => Promise.resolve({ data, error: null }).then(resolve),
  };
  return chain;
}

function tenantScopedDb() {
  return {
    from: (table: string) => {
      if (table === 'features') return query([{ id: 'feature-1', key: 'booking.calendar', name: 'Agenda', domain: 'booking', kind: 'configurable', status: 'active' }]);
      if (table === 'tenant_subscriptions') return query([{ id: 'subscription-1', plan_id: 'plan-1', status: 'active', started_at: '2026-08-01T00:00:00Z', ended_at: null }]);
      if (table === 'tenant_feature_overrides') return query([]);
      if (table === 'tenant_feature_usage') return query([]);
      if (table === 'plans') return query({ id: 'plan-1', key: 'compatibility', name: 'Compatibilidade integral', version: 1 });
      if (table === 'plan_feature_rules') return query([{ feature_id: 'feature-1', enabled: true, limit_value: null, config: {} }]);
      throw new Error(`Tabela não esperada no teste: ${table}`);
    },
  };
}

describe('getTenantEntitlements — isolamento RLS', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('usa getDb sob o contexto do tenant e nunca o cliente de plataforma', async () => {
    getTenantDbContextMock.mockReturnValue({ tenantId: 'tenant-jwt', source: 'authenticated_request' });
    getDbMock.mockReturnValue(tenantScopedDb() as any);

    const result = await getTenantEntitlements();

    expect(getDbMock).toHaveBeenCalledOnce();
    expect(getPlatformDbMock).not.toHaveBeenCalled();
    expect(result.tenantId).toBe('tenant-jwt');
    expect(result.entitlements).toMatchObject([{ key: 'booking.calendar', enabled: true, source: 'plan' }]);
  });

  it('recusa leitura sem contexto em vez de cair para uma chave de plataforma', async () => {
    getTenantDbContextMock.mockReturnValue(undefined);

    await expect(getTenantEntitlements()).rejects.toThrow('Leitura de entitlements sem contexto de tenant recusada.');
    expect(getDbMock).not.toHaveBeenCalled();
    expect(getPlatformDbMock).not.toHaveBeenCalled();
  });
});
