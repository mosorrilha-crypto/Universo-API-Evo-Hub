import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getDb: vi.fn(),
  recordOperationEvent: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../db', () => ({ getDb: mocks.getDb }));
vi.mock('../operationEventStore', () => ({ recordOperationEvent: mocks.recordOperationEvent }));

import {
  createMetaCampaign,
  metaAdsManagementLimits,
  MetaAdsManagementValidationError,
  updateMetaCampaignBudget,
} from '../metaAdsManagementService';

type OperationRow = {
  id: string;
  tenant_id: string;
  idempotency_key: string;
  operation: string;
  resource_id: string | null;
  status: 'pending' | 'succeeded' | 'failed';
  response: Record<string, unknown> | null;
  error_message: string | null;
};

function createFakeDb() {
  const credentials = { meta_ads_account_id: 'act_123', meta_ads_management_access_token: 'management-token' };
  const operations: OperationRow[] = [];
  let sequence = 0;

  const from = (table: string) => {
    const filters: Record<string, unknown> = {};
    const query: any = {
      select: () => query,
      eq: (field: string, value: unknown) => { filters[field] = value; return query; },
      maybeSingle: async () => {
        if (table === 'tenant_meta_credentials') return { data: credentials, error: null };
        const row = operations.find((item) => item.tenant_id === filters.tenant_id && item.idempotency_key === filters.idempotency_key && item.operation === filters.operation);
        return { data: row || null, error: null };
      },
      insert: (payload: Record<string, unknown>) => {
        const row: OperationRow = {
          id: `operation-${++sequence}`,
          tenant_id: String(payload.tenant_id),
          idempotency_key: String(payload.idempotency_key),
          operation: String(payload.operation),
          resource_id: payload.resource_id ? String(payload.resource_id) : null,
          status: 'pending',
          response: null,
          error_message: null,
        };
        operations.push(row);
        const insertQuery: any = {
          select: () => insertQuery,
          single: async () => ({ data: row, error: null }),
        };
        return insertQuery;
      },
      update: (changes: Record<string, unknown>) => {
        const updateQuery: any = {
          eq: (field: string, value: unknown) => {
            for (const row of operations) {
              if (row[field as keyof OperationRow] === value) Object.assign(row, changes);
            }
            return updateQuery;
          },
        };
        return updateQuery;
      },
    };
    return query;
  };

  return { db: { from }, operations };
}

describe('metaAdsManagementService', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    mocks.recordOperationEvent.mockResolvedValue(undefined);
  });

  it('cria campanha Click to WhatsApp pausada com categorias especiais vazias', async () => {
    const fake = createFakeDb();
    mocks.getDb.mockReturnValue(fake.db);
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: '987654321' }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await createMetaCampaign('tenant-a', {
      name: 'Combo Full Face — Luque',
      objective: 'OUTCOME_ENGAGEMENT',
      specialAdCategories: [],
    }, 'meta-test-create-123456');

    expect(result).toEqual({ id: '987654321', name: 'Combo Full Face — Luque', objective: 'OUTCOME_ENGAGEMENT', status: 'PAUSED' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const request = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(request.method).toBe('POST');
    expect(String(request.body)).toContain('status=PAUSED');
    expect(String(request.body)).toContain('special_ad_categories=%5B%5D');
    expect(fake.operations[0]?.status).toBe('succeeded');
    expect(mocks.recordOperationEvent).toHaveBeenCalledWith(expect.objectContaining({ tenantId: 'tenant-a', eventType: 'meta_ads_create_campaign' }));
  });

  it('reutiliza o resultado idempotente e não repete a chamada externa', async () => {
    const fake = createFakeDb();
    mocks.getDb.mockReturnValue(fake.db);
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: '987654321' }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const input = { name: 'Campanha única', objective: 'OUTCOME_ENGAGEMENT', specialAdCategories: [] };
    await createMetaCampaign('tenant-a', input, 'meta-test-same-123456');
    const second = await createMetaCampaign('tenant-a', input, 'meta-test-same-123456');

    expect(second.id).toBe('987654321');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('recusa orçamento decimal, zero ou acima do limite antes de chamar a Meta', async () => {
    const fake = createFakeDb();
    mocks.getDb.mockReturnValue(fake.db);
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await expect(updateMetaCampaignBudget('tenant-a', '987654321', 0, 'meta-test-budget-123456'))
      .rejects.toBeInstanceOf(MetaAdsManagementValidationError);
    await expect(updateMetaCampaignBudget('tenant-a', '987654321', 100.5, 'meta-test-budget-123457'))
      .rejects.toBeInstanceOf(MetaAdsManagementValidationError);
    await expect(updateMetaCampaignBudget('tenant-a', '987654321', metaAdsManagementLimits().maxDailyBudgetMinor + 1, 'meta-test-budget-123458'))
      .rejects.toBeInstanceOf(MetaAdsManagementValidationError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejeita chave de idempotência curta, impedindo operação sem rastreabilidade', async () => {
    const fake = createFakeDb();
    mocks.getDb.mockReturnValue(fake.db);
    vi.stubGlobal('fetch', vi.fn());

    await expect(createMetaCampaign('tenant-a', { name: 'Campanha', objective: 'OUTCOME_ENGAGEMENT' }, 'curta'))
      .rejects.toBeInstanceOf(MetaAdsManagementValidationError);
  });
});
