import express from 'express';
import type { Server } from 'http';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createMetaCampaign: vi.fn(),
  updateMetaCampaignStatus: vi.fn(),
  updateMetaCampaignBudget: vi.fn(),
}));

vi.mock('../../services/metaAdsManagementService', () => {
  class MetaAdsManagementConfigurationError extends Error {}
  class MetaAdsManagementRequestError extends Error {}
  class MetaAdsManagementValidationError extends Error {}
  class MetaAdsOperationAlreadyFailedError extends Error {}
  class MetaAdsOperationInProgressError extends Error {}
  return {
    ...mocks,
    MetaAdsManagementConfigurationError,
    MetaAdsManagementRequestError,
    MetaAdsManagementValidationError,
    MetaAdsOperationAlreadyFailedError,
    MetaAdsOperationInProgressError,
  };
});

import { createMetaAdsRouter } from '../metaAds';

let server: Server;
let baseUrl: string;
let role = 'admin';
const TENANT_ID = 'tenant-from-jwt';

function authenticateToken(req: any, _res: any, next: any) {
  req.user = { id: 'admin-1', tenantId: TENANT_ID, role };
  next();
}

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use(createMetaAdsRouter({ authenticateToken: authenticateToken as any }));
  await new Promise<void>((resolve) => {
    server = app.listen(0, resolve);
  });
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  baseUrl = `http://127.0.0.1:${port}`;
});

afterAll(() => server.close());

beforeEach(() => {
  role = 'admin';
  mocks.createMetaCampaign.mockReset();
  mocks.updateMetaCampaignStatus.mockReset();
  mocks.updateMetaCampaignBudget.mockReset();
});

describe('Central de Anúncios Meta — guardrails da rota', () => {
  it('exige confirmação e não chama o serviço sem ela', async () => {
    const response = await fetch(`${baseUrl}/api/meta-ads/campaigns`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': 'meta-route-test-123456' },
      body: JSON.stringify({ name: 'Campanha', objective: 'OUTCOME_ENGAGEMENT' }),
    });

    expect(response.status).toBe(428);
    expect(mocks.createMetaCampaign).not.toHaveBeenCalled();
  });

  it('usa o tenant do JWT, ignora tenant enviado no body e encaminha a chave de idempotência', async () => {
    mocks.createMetaCampaign.mockResolvedValue({ id: 'campaign-1', name: 'Campanha', status: 'PAUSED' });

    const response = await fetch(`${baseUrl}/api/meta-ads/campaigns`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': 'meta-route-test-123457' },
      body: JSON.stringify({ tenantId: 'tenant-injetado', name: 'Campanha', objective: 'OUTCOME_ENGAGEMENT', confirmation: 'CONFIRMAR_NO_UNIVERSO' }),
    });

    expect(response.status).toBe(201);
    expect(mocks.createMetaCampaign).toHaveBeenCalledWith(
      TENANT_ID,
      expect.objectContaining({ tenantId: 'tenant-injetado', name: 'Campanha' }),
      'meta-route-test-123457',
    );
  });

  it('recusa operador, mesmo com confirmação', async () => {
    role = 'operator';
    const response = await fetch(`${baseUrl}/api/meta-ads/campaigns`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': 'meta-route-test-123458' },
      body: JSON.stringify({ name: 'Campanha', objective: 'OUTCOME_ENGAGEMENT', confirmation: 'CONFIRMAR_NO_UNIVERSO' }),
    });

    expect(response.status).toBe(403);
    expect(mocks.createMetaCampaign).not.toHaveBeenCalled();
  });

  it('exige confirmação também para status e orçamento', async () => {
    const statusResponse = await fetch(`${baseUrl}/api/meta-ads/campaigns/123/status`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': 'meta-route-test-123459' },
      body: JSON.stringify({ status: 'ACTIVE' }),
    });
    const budgetResponse = await fetch(`${baseUrl}/api/meta-ads/campaigns/123/budget`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': 'meta-route-test-123460' },
      body: JSON.stringify({ dailyBudgetMinor: 100000 }),
    });

    expect(statusResponse.status).toBe(428);
    expect(budgetResponse.status).toBe(428);
    expect(mocks.updateMetaCampaignStatus).not.toHaveBeenCalled();
    expect(mocks.updateMetaCampaignBudget).not.toHaveBeenCalled();
  });
});
