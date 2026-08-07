import { Router, type RequestHandler } from 'express';
import { getQueueStats } from '../services/transcriptionQueue';

interface TelemetryRouterDeps {
  authenticateToken: RequestHandler;
  rateLimiter: RequestHandler;
}

export function createTelemetryRouter({ authenticateToken, rateLimiter }: TelemetryRouterDeps): Router {
  const router = Router();

  // Telemetria de Tokens & Cache AI Strategy
  let mockAiEnabled = false;

  router.get('/api/telemetry/tokens', authenticateToken, (req, res) => {
    res.json({
      useMockAiMode: mockAiEnabled,
      summary: {
        totalSaaSTokens: 1425800,
        totalSaaSCostUSD: 0.14,
        totalCachedSaved: 850000,
        totalRequests: 3420,
      },
      tenantsTelemetry: [
        {
          tenantId: 'main-tenant',
          tenantName: 'Monique Studio VIP',
          inputTokens: 820000,
          outputTokens: 140000,
          cachedTokens: 510000,
          totalCostUSD: 0.08,
          requestCount: 1820,
          lastActive: new Date().toISOString(),
        },
        {
          tenantId: 'tenant_clinica_2',
          tenantName: 'Clínica Odonto Prime',
          inputTokens: 380000,
          outputTokens: 85800,
          cachedTokens: 340000,
          totalCostUSD: 0.06,
          requestCount: 1600,
          lastActive: new Date().toISOString(),
        }
      ]
    });
  });

  router.post('/api/telemetry/toggle-mock', authenticateToken, (req, res) => {
    const { enabled } = req.body || {};
    mockAiEnabled = typeof enabled === 'boolean' ? enabled : !mockAiEnabled;
    res.json({ useMockAiMode: mockAiEnabled, message: `Mock AI Mode ${mockAiEnabled ? 'Ativado' : 'Desativado'}` });
  });

  // Status real da fila de transcrição (server/services/transcriptionQueue.ts) —
  // substitui os números fixos que existiam aqui antes (Epic 5.1.3 do roadmap).
  // Achado numa auditoria externa: única rota deste arquivo sem
  // authenticateToken, expondo métricas internas da fila sem autenticação.
  router.get('/api/queue/status', authenticateToken, (req, res) => {
    res.json(getQueueStats());
  });

  router.post('/api/batch/lead-analysis', authenticateToken, rateLimiter, (req, res) => {
    res.json({
      success: true,
      processedCount: 10,
      savedTokens: 42000,
      executionTimeMs: 1250,
      timestamp: new Date().toISOString()
    });
  });

  return router;
}
