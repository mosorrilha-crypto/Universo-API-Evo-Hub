import { Router, type RequestHandler } from 'express';
import { saveSubscription, removeSubscription } from '../services/pushSubscriptionStore';
import type { AuthenticatedRequest } from '../middleware/auth';
import { asyncHandler } from '../middleware/asyncHandler';
import { resolveTenantId } from '../middleware/rbac';

interface PushSubscriptionsRouterDeps {
  authenticateToken: RequestHandler;
  vapidPublicKey?: string;
}

/** tenantId de verdade da requisição — vem do JWT, exceto pra saas_admin usando o seletor de tenant do painel (ver resolveTenantId em middleware/rbac.ts). */
function tenantOf(req: AuthenticatedRequest): string {
  return resolveTenantId(req);
}

function operatorOf(req: AuthenticatedRequest): string {
  if (!req.user?.id) {
    throw new Error('Sessão autenticada sem id de operador — recusado.');
  }
  return req.user.id;
}

/**
 * Assinatura de Web Push do PWA do atendente (issue #159). A chave pública
 * VAPID é servida por endpoint (não embutida no build do frontend) pra
 * poder trocar sem precisar de novo deploy do bundle.
 */
export function createPushSubscriptionsRouter({ authenticateToken, vapidPublicKey }: PushSubscriptionsRouterDeps): Router {
  const router = Router();

  router.get('/api/push/vapid-public-key', authenticateToken, (_req, res) => {
    if (!vapidPublicKey) {
      res.status(503).json({ error: 'Push notification não configurado neste servidor (VAPID ausente).' });
      return;
    }
    res.json({ publicKey: vapidPublicKey });
  });

  router.post('/api/push/subscribe', authenticateToken, asyncHandler(async (req: AuthenticatedRequest, res) => {
    const { subscription, userAgent } = req.body || {};
    if (!subscription?.endpoint || !subscription?.keys?.p256dh || !subscription?.keys?.auth) {
      res.status(400).json({ error: 'subscription inválida — esperado { endpoint, keys: { p256dh, auth } }.' });
      return;
    }
    await saveSubscription(tenantOf(req), operatorOf(req), subscription, typeof userAgent === 'string' ? userAgent : undefined);
    res.json({ success: true });
  }));

  router.post('/api/push/unsubscribe', authenticateToken, asyncHandler(async (req: AuthenticatedRequest, res) => {
    const { endpoint } = req.body || {};
    if (typeof endpoint !== 'string' || !endpoint) {
      res.status(400).json({ error: 'endpoint obrigatório.' });
      return;
    }
    await removeSubscription(tenantOf(req), endpoint);
    res.json({ success: true });
  }));

  return router;
}
