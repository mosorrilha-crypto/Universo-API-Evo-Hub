import { Router, type RequestHandler, type Response } from 'express';
import type { AuthenticatedRequest } from '../middleware/auth';
import { asyncHandler } from '../middleware/asyncHandler';
import { requireRole, resolveTenantId } from '../middleware/rbac';
import {
  getMetaAdsConnectionStatus,
  getMetaTrafficOverview,
  isTrafficDatePreset,
  MetaAdsConfigurationError,
  MetaAdsRequestError,
  MetaAdsTokenExpiredError,
  saveMetaAdsConnection,
} from '../services/metaAdsInsightsService';
import {
  createMetaCampaign,
  MetaAdsManagementConfigurationError,
  MetaAdsManagementRequestError,
  MetaAdsManagementValidationError,
  MetaAdsOperationAlreadyFailedError,
  MetaAdsOperationInProgressError,
  updateMetaCampaignBudget,
  updateMetaCampaignStatus,
} from '../services/metaAdsManagementService';

interface MetaAdsRouterDeps {
  authenticateToken: RequestHandler;
}

function tenantOf(req: AuthenticatedRequest): string {
  return resolveTenantId(req);
}

/**
 * Central de Tráfego e Anúncios — leitura e operações supervisionadas da Marketing API.
 *
 * A rota nunca recebe a conta por query/body e nunca retorna access token.
 * O tenant é sempre o do JWT, exceto pelo seletor legítimo de saas_admin.
 * Toda escrita exige um token separado com ads_management, confirmação textual
 * e chave Idempotency-Key; campanhas novas sempre nascem PAUSED.
 */
export function createMetaAdsRouter({ authenticateToken }: MetaAdsRouterDeps): Router {
  const router = Router();

  router.get('/api/meta-ads/connection', authenticateToken, requireRole('admin'), asyncHandler(async (req: AuthenticatedRequest, res) => {
    const connection = await getMetaAdsConnectionStatus(tenantOf(req));
    res.json({ connection });
  }));

  router.put('/api/meta-ads/connection', authenticateToken, requireRole('admin'), asyncHandler(async (req: AuthenticatedRequest, res) => {
    const { adAccountId, accessToken, managementAccessToken } = req.body || {};
    if (typeof adAccountId !== 'string') {
      return res.status(400).json({ error: 'Informe a conta de anúncios no formato act_<id>.' });
    }
    if (accessToken !== undefined && accessToken !== null && typeof accessToken !== 'string') {
      return res.status(400).json({ error: 'O token de acesso precisa ser texto.' });
    }
    if (managementAccessToken !== undefined && managementAccessToken !== null && typeof managementAccessToken !== 'string') {
      return res.status(400).json({ error: 'O token de gerenciamento precisa ser texto.' });
    }

    try {
      const connection = await saveMetaAdsConnection(tenantOf(req), { adAccountId, accessToken, managementAccessToken });
      res.json({ success: true, connection });
    } catch (error: any) {
      if (error instanceof MetaAdsConfigurationError) return res.status(400).json({ error: error.message });
      throw error;
    }
  }));

  router.post('/api/meta-ads/campaigns', authenticateToken, requireRole('admin'), asyncHandler(async (req: AuthenticatedRequest, res) => {
    const confirmation = req.body?.confirmation;
    const idempotencyKey = req.header('Idempotency-Key');
    if (!idempotencyKey) return res.status(400).json({ error: 'A operação precisa de um header Idempotency-Key.' });
    if (confirmation !== 'CONFIRMAR_NO_UNIVERSO') {
      return res.status(428).json({ error: 'Confirme a criação da campanha como PAUSED antes de continuar.' });
    }
    try {
      const campaign = await createMetaCampaign(tenantOf(req), req.body || {}, idempotencyKey);
      return res.status(201).json({ success: true, campaign });
    } catch (error: any) {
      return sendMetaManagementError(res, error);
    }
  }));

  router.post('/api/meta-ads/campaigns/:campaignId/status', authenticateToken, requireRole('admin'), asyncHandler(async (req: AuthenticatedRequest, res) => {
    const confirmation = req.body?.confirmation;
    const idempotencyKey = req.header('Idempotency-Key');
    if (!idempotencyKey) return res.status(400).json({ error: 'A operação precisa de um header Idempotency-Key.' });
    if (confirmation !== 'CONFIRMAR_NO_UNIVERSO') {
      return res.status(428).json({ error: 'Confirme a alteração de status antes de continuar.' });
    }
    try {
      const campaign = await updateMetaCampaignStatus(tenantOf(req), req.params.campaignId, req.body?.status, idempotencyKey);
      return res.json({ success: true, campaign });
    } catch (error: any) {
      return sendMetaManagementError(res, error);
    }
  }));

  router.post('/api/meta-ads/campaigns/:campaignId/budget', authenticateToken, requireRole('admin'), asyncHandler(async (req: AuthenticatedRequest, res) => {
    const confirmation = req.body?.confirmation;
    const idempotencyKey = req.header('Idempotency-Key');
    if (!idempotencyKey) return res.status(400).json({ error: 'A operação precisa de um header Idempotency-Key.' });
    if (confirmation !== 'CONFIRMAR_NO_UNIVERSO') {
      return res.status(428).json({ error: 'Confirme o novo orçamento diário antes de continuar.' });
    }
    try {
      const campaign = await updateMetaCampaignBudget(tenantOf(req), req.params.campaignId, req.body?.dailyBudgetMinor, idempotencyKey);
      return res.json({ success: true, campaign });
    } catch (error: any) {
      return sendMetaManagementError(res, error);
    }
  }));

  router.get('/api/meta-ads/insights', authenticateToken, requireRole('admin'), asyncHandler(async (req: AuthenticatedRequest, res) => {
    const datePreset = req.query.datePreset;
    if (!isTrafficDatePreset(datePreset)) {
      return res.status(400).json({ error: 'Período inválido. Use today, last_7d, last_14d ou last_30d.' });
    }

    try {
      const overview = await getMetaTrafficOverview(tenantOf(req), datePreset);
      res.json({ overview });
    } catch (error: any) {
      if (error instanceof MetaAdsConfigurationError) return res.status(409).json({ error: error.message, code: 'META_ADS_NOT_CONFIGURED' });
      if (error instanceof MetaAdsTokenExpiredError) return res.status(401).json({ error: error.message, code: 'META_ADS_TOKEN_EXPIRED' });
      if (error instanceof MetaAdsRequestError) return res.status(502).json({ error: error.message, code: 'META_ADS_REQUEST_FAILED' });
      throw error;
    }
  }));

  return router;
}

function sendMetaManagementError(res: Response, error: unknown) {
  if (error instanceof MetaAdsManagementConfigurationError) return res.status(409).json({ error: error.message, code: 'META_ADS_MANAGEMENT_NOT_CONFIGURED' });
  if (error instanceof MetaAdsManagementValidationError) return res.status(400).json({ error: error.message, code: 'META_ADS_MANAGEMENT_INVALID_INPUT' });
  if (error instanceof MetaAdsOperationInProgressError) return res.status(409).json({ error: error.message, code: 'META_ADS_OPERATION_IN_PROGRESS' });
  if (error instanceof MetaAdsOperationAlreadyFailedError) return res.status(409).json({ error: error.message, code: 'META_ADS_OPERATION_FAILED' });
  if (error instanceof MetaAdsManagementRequestError) return res.status(502).json({ error: error.message, code: 'META_ADS_REQUEST_FAILED' });
  throw error;
}
