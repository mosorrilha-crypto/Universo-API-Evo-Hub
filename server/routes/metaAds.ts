import { Router, type RequestHandler } from 'express';
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

interface MetaAdsRouterDeps {
  authenticateToken: RequestHandler;
}

function tenantOf(req: AuthenticatedRequest): string {
  return resolveTenantId(req);
}

/**
 * Central de Tráfego — somente leitura da Marketing API.
 *
 * A rota nunca recebe a conta por query/body e nunca retorna access token.
 * O tenant é sempre o do JWT, exceto pelo seletor legítimo de saas_admin.
 */
export function createMetaAdsRouter({ authenticateToken }: MetaAdsRouterDeps): Router {
  const router = Router();

  router.get('/api/meta-ads/connection', authenticateToken, requireRole('admin'), asyncHandler(async (req: AuthenticatedRequest, res) => {
    const connection = await getMetaAdsConnectionStatus(tenantOf(req));
    res.json({ connection });
  }));

  router.put('/api/meta-ads/connection', authenticateToken, requireRole('admin'), asyncHandler(async (req: AuthenticatedRequest, res) => {
    const { adAccountId, accessToken } = req.body || {};
    if (typeof adAccountId !== 'string') {
      return res.status(400).json({ error: 'Informe a conta de anúncios no formato act_<id>.' });
    }
    if (accessToken !== undefined && accessToken !== null && typeof accessToken !== 'string') {
      return res.status(400).json({ error: 'O token de acesso precisa ser texto.' });
    }

    try {
      const connection = await saveMetaAdsConnection(tenantOf(req), { adAccountId, accessToken });
      res.json({ success: true, connection });
    } catch (error: any) {
      if (error instanceof MetaAdsConfigurationError) return res.status(400).json({ error: error.message });
      throw error;
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
