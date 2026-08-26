import { Router, type RequestHandler } from 'express';
import { asyncHandler } from '../middleware/asyncHandler';
import type { AuthenticatedRequest } from '../middleware/auth';
import { getTenantEntitlements } from '../services/featureEntitlementService';

export function createEntitlementsRouter({ authenticateToken }: { authenticateToken: RequestHandler }): Router {
  const router = Router();

  // A UI sempre enxerga apenas o contrato do tenant que veio no JWT. Não há
  // tenantId em body/query/param, pois isso transformaria uma tela de plano em
  // uma superfície de leitura cross-tenant.
  router.get('/api/me/entitlements', authenticateToken, asyncHandler(async (req: AuthenticatedRequest, res) => {
    const tenantId = req.user?.tenantId;
    if (!tenantId) return res.status(403).json({ error: 'Sessão sem tenant válido.' });
    const entitlements = await getTenantEntitlements(tenantId);
    res.json(entitlements);
  }));

  return router;
}
