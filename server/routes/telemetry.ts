import { Router, type RequestHandler } from 'express';
import { getQueueStats } from '../services/transcriptionQueue';
import { getTokenTelemetry } from '../services/tokenUsageStore';
import { asyncHandler } from '../middleware/asyncHandler';

interface TelemetryRouterDeps {
  authenticateToken: RequestHandler;
}

export function createTelemetryRouter({ authenticateToken }: TelemetryRouterDeps): Router {
  const router = Router();

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
  // Issue #90 — gravação real de usageMetadata agora existe
  // (server/services/tokenUsageStore.ts, chamada a partir de
  // server/services/autoReply.ts a cada chamada Gemini). Agregado dos
  // últimos 30 dias, por tenant.
  //
  // Achado real em produção (14/08/2026): a rota também mandava
  // `useMockAiMode`/tinha um POST /api/telemetry/toggle-mock pra ligar um
  // "Modo Mock Local" no painel — mas nenhum lugar do código que realmente
  // chama o Gemini (server/gemini.ts, autoReply.ts) lia esse valor. Era só
  // uma variável indo e voltando entre o painel e esta rota, sem interceptar
  // chamada real nenhuma — parecia proteção de custo, não protegia nada.
  // Removido (usuário pediu explicitamente pra tirar tudo que é fake/mock
  // desta tela).
  router.get('/api/telemetry/tokens', authenticateToken, asyncHandler(async (req, res) => {
    const { summary, tenantsTelemetry } = await getTokenTelemetry();
    res.json({ summary, tenantsTelemetry });
  }));

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
    });
  });

  return router;
}
