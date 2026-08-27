import { Router, type RequestHandler } from 'express';
import { asyncHandler } from '../middleware/asyncHandler';
import type { AuthenticatedRequest } from '../middleware/auth';
import { resolveTenantId } from '../middleware/rbac';
import { getTenantEntitlements } from '../services/featureEntitlementService';

export function createEntitlementsRouter({ authenticateToken }: { authenticateToken: RequestHandler }): Router {
  const router = Router();

  // A UI nunca aceita tenantId por body/query/param. O único override válido
  // é o X-Tenant-Id já validado por resolveTenantId para saas_admin; para os
  // demais papéis, o contexto continua obrigatoriamente no tenant do JWT.
  router.get('/api/me/entitlements', authenticateToken, asyncHandler(async (req: AuthenticatedRequest, res) => {
    if (!req.user?.tenantId) return res.status(403).json({ error: 'Sessão sem tenant válido.' });
    resolveTenantId(req);
    const entitlements = await getTenantEntitlements();
    res.json(entitlements);
  }));

  return router;
}
