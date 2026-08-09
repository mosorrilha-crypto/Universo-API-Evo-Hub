import { Router, type RequestHandler } from 'express';
import { getQueueStats } from '../services/transcriptionQueue';

interface TelemetryRouterDeps {
  authenticateToken: RequestHandler;
}

export function createTelemetryRouter({ authenticateToken }: TelemetryRouterDeps): Router {
  const router = Router();

  // Telemetria de Tokens & Cache AI Strategy
  let mockAiEnabled = false;

  // Achado real em produção ("Telemetria de Tokens IA" jogava o painel numa
  // tela branca): esta rota respondia com números fabricados (tenant
  // fictício "Clínica Odonto Prime" incluído) usando nomes de campo
  // diferentes dos que o frontend espera (TenantTokenTelemetry em
  // src/types.ts: promptTokens/candidatesTokens/totalTokens/
  // cachedTokensSaved/estimatedCostUSD/lastRequestAt — a resposta antiga
  // mandava inputTokens/outputTokens/cachedTokens/totalCostUSD/lastActive, e
  // nunca mandava totalTokens nenhum). O frontend já tinha lógica pra mostrar
  // "Nenhum tenant com consumo de tokens registrado ainda" quando não há
  // dado real (achado numa auditoria anterior, ver SaaSAdminDashboard.tsx) —
  // mas como esta rota SEMPRE respondia com sucesso, essa lógica nunca era
  // alcançada. Em vez disso, `tenantsTelemetry[i].totalTokens.toLocaleString()`
  // (campo que nunca existiu na resposta) lançava TypeError sem nenhum
  // Error Boundary no app — React desmontava a árvore inteira, tela branca.
  // Não existe nenhuma gravação real de uso de tokens no backend ainda
  // (grep por "usageMetadata"/"token_telemetry" não encontra nada) — resposta
  // honesta e vazia até essa métrica ser implementada de verdade, em vez de
  // inventar números de negócio.
  router.get('/api/telemetry/tokens', authenticateToken, (req, res) => {
    res.json({
      useMockAiMode: mockAiEnabled,
      summary: {
        totalSaaSTokens: 0,
        totalSaaSCostUSD: 0,
        totalCachedSaved: 0,
        totalRequests: 0,
      },
      tenantsTelemetry: [],
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
  //
  // Achado real em produção (mesma investigação da tela branca acima):
  // getQueueStats() sempre teve nomes de campo diferentes do que o frontend
  // espera (QueueSystemStatus em src/types.ts) — activeWorkers/pendingQueue/
  // processedTotal/failedTotal em vez de activeJobs/waitingJobs/
  // completedJobs/failedJobs. Não travava a tela (os campos só entram em
  // template string, "undefined" vira texto em vez de lançar), mas mostrava
  // "undefined Jobs Concluídos" no painel. Mapeado pros nomes certos.
  router.get('/api/queue/status', authenticateToken, (req, res) => {
    const stats = getQueueStats();
    res.json({
      activeJobs: stats.activeWorkers,
      waitingJobs: stats.pendingQueue,
      completedJobs: stats.processedTotal,
      failedJobs: stats.failedTotal,
      rateLimitRPM: 60,
      mockModeEnabled: mockAiEnabled,
      contextCacheEnabled: false,
    });
  });

  return router;
}
