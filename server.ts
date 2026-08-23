import express from 'express';
import path from 'path';
import dotenv from 'dotenv';
import { createServer as createViteServer } from 'vite';

import { loadConfig } from './server/config';
import { createSupabaseClientFromConfig } from './server/supabaseClient';
import { getGeminiClient } from './server/gemini';
import { createAuthenticateToken } from './server/middleware/auth';
import { aiRateLimiter, spaFallbackRateLimiter } from './server/middleware/rateLimit';
import { createAuthRouter } from './server/routes/auth';
import { createAiRouter } from './server/routes/ai';
import { createTelemetryRouter } from './server/routes/telemetry';
import { createWebhooksRouter } from './server/routes/webhooks';
import { createMetaCapiRouter } from './server/routes/metaCapi';
import { createMetaAdsRouter } from './server/routes/metaAds';
import { createConversationsRouter } from './server/routes/conversations';
import { createGoogleCalendarRouter } from './server/routes/googleCalendar';
import { createAdminRouter } from './server/routes/admin';
import { createRoadmapRouter } from './server/routes/roadmap';
import { createCrmRouter } from './server/routes/crm';
import { createFinancialRouter } from './server/routes/financial';
import { createPushSubscriptionsRouter } from './server/routes/pushSubscriptions';
import { createQualityAuditRouter } from './server/routes/qualityAudit';
import { createPublicCatalogRouter } from './server/routes/publicCatalog';
import { startTranscriptionWorker } from './server/services/transcriptionQueue';
import { initDb } from './server/services/db';
import { startReminderJob } from './server/services/reminderJob';
import { startPreReservationFollowUpJob } from './server/services/preReservationFollowUpJob';
import { startPendingFollowUpJob } from './server/services/pendingFollowUpJob';
import { startAgentPausedAlertJob } from './server/services/agentPausedAlertJob';
import { startPaymentPendingAlertJob } from './server/services/paymentPendingAlertJob';
import { startHeldAppointmentExpiryJob } from './server/services/heldAppointmentExpiryJob';
import { initWebPush } from './server/services/webPush';
import { notifySystemError } from './server/services/systemErrorAlertService';
import { configureAdminAlertChannel } from './server/services/adminAlertChannel';

dotenv.config();

// Rede de segurança de nível de processo — SEM isso, um erro não tratado em
// QUALQUER handler async de rota (Express 4 não captura rejeição de promise
// de handler async sozinho) vira um "unhandled rejection", e por padrão o
// Node 22+ mata o processo inteiro. Isso derruba o servidor pra TODOS os
// tenants de uma vez só (não só a requisição que falhou) — foi exatamente
// a causa raiz de uma queda real em produção (502 generalizado) rastreada
// numa auditoria de código, reproduzida localmente antes desta correção.
// Loga e mantém o processo vivo; o middleware de erro global (abaixo, em
// startServer) cuida de devolver uma resposta HTTP decente pra quem
// disparou o erro, quando a rota usa asyncHandler.
process.on('unhandledRejection', (reason) => {
  const message = reason instanceof Error ? reason.stack || reason.message : String(reason);
  console.error('🔥 [unhandledRejection] Erro não tratado — processo continua vivo:', message);
  // Issue #111 — sem isso, esse tipo de erro só existia no log do Render;
  // ninguém era avisado até um cliente reclamar. Nunca lança, nunca bloqueia
  // (ver systemErrorAlertService.ts).
  notifySystemError({ source: 'unhandledRejection', message }).catch(() => {});
});
process.on('uncaughtException', (err) => {
  console.error('🔥 [uncaughtException] Erro não tratado — processo continua vivo:', err.stack || err.message);
  notifySystemError({ source: 'uncaughtException', message: err.message }).catch(() => {});
});

async function startServer() {
  const config = loadConfig();
  const app = express();

  // Achado real em produção: o Render (nosso host) fica atrás de um proxy
  // reverso que sempre seta X-Forwarded-For, mas o Express nunca declarou
  // confiar em proxy nenhum (padrão: false). Sem isso, req.ip do
  // express-rate-limit sempre resolve pro IP do socket (o proxy do Render),
  // nunca pro IP real do cliente em X-Forwarded-For — o rate limit de
  // aiRateLimiter (20 req/min) virava um limite ÚNICO COMPARTILHADO entre
  // TODOS os usuários do app ao mesmo tempo, em vez de por pessoa (um
  // operador ativo podia estourar o limite pra todo mundo). `1` (não
  // `true`) porque o Render adiciona exatamente UM hop de proxy — `true`
  // confiaria em qualquer X-Forwarded-For vindo do próprio cliente, o que
  // permitiria burlar o rate limit por IP forjando o header.
  app.set('trust proxy', 1);

  const supabase = createSupabaseClientFromConfig(config);
  const authenticateToken = createAuthenticateToken(config.jwtSecret);

  // Os 8 serviços (Bloco 2.A) leem/escrevem em tabelas Postgres reais
  // através deste único cliente Supabase compartilhado — nada mais fica em
  // memória ou em JSON solto no Storage.
  initDb(supabase);
  if (!supabase) {
    console.warn('⚠️  SUPABASE_URL/SUPABASE_KEY ausentes — conversas, agenda, base de conhecimento e login real não vão funcionar até configurar.');
  }

  // Credencial compartilhada (.env) pro canal de alerta AO OPERADOR (não é o
  // canal de mensagem do cliente) — issue #290, seção 1: os 3 serviços de
  // alerta (systemErrorAlertService/escalationAlertService/agentPausedAlertJob)
  // nunca recebiam isso antes, então caíam sempre no fallback Meta vazio e
  // nunca tentavam Evolution API pro tenant que atende de verdade por lá.
  configureAdminAlertChannel({
    metaAccessToken: config.metaAccessToken,
    metaPhoneNumberId: config.metaPhoneNumberId,
    evolutionApiUrl: config.evolutionApiUrl,
    evolutionApiKey: config.evolutionApiKey,
    evolutionInstanceName: config.evolutionInstanceName,
  });

  app.use(express.json({
    limit: '50mb',
    verify: (req: any, _res, buf) => {
      req.rawBody = buf;
    }
  }));
  app.use(express.urlencoded({ limit: '50mb', extended: true }));

  // O catálogo público é montado sem autenticação, mas resolve o tenant pelo
  // slug e só publica tenants explicitamente habilitados na migration 0042.
  app.use(createPublicCatalogRouter());

  app.use(createAuthRouter({ jwtSecret: config.jwtSecret, supabase }));
  app.use(createAiRouter({ config, authenticateToken, rateLimiter: aiRateLimiter }));
  app.use(createTelemetryRouter({ authenticateToken }));
  app.use(createWebhooksRouter({
      metaWebhookVerifyToken: config.metaWebhookVerifyToken,
    metaAppSecret: config.metaAppSecret,
    getAi: () => getGeminiClient(config),
    groqApiKey: config.groqApiKey,
    metaAccessToken: config.metaAccessToken,
    metaPhoneNumberId: config.metaPhoneNumberId,
    evolutionApiUrl: config.evolutionApiUrl,
    evolutionApiKey: config.evolutionApiKey,
    evolutionInstanceName: config.evolutionInstanceName,
    supabaseUrl: config.supabaseUrl,
    supabaseKey: config.supabaseKey,
    googleClientId: config.googleClientId,
    googleClientSecret: config.googleClientSecret,
    googleRedirectUri: config.googleRedirectUri,
  }));
  app.use(createMetaCapiRouter({ authenticateToken }));
  app.use(createMetaAdsRouter({ authenticateToken }));
  app.use(createConversationsRouter({
    authenticateToken,
    jwtSecret: config.jwtSecret,
    metaAccessToken: config.metaAccessToken,
    metaPhoneNumberId: config.metaPhoneNumberId,
    evolutionApiUrl: config.evolutionApiUrl,
    evolutionApiKey: config.evolutionApiKey,
    evolutionInstanceName: config.evolutionInstanceName,
    supabaseUrl: config.supabaseUrl,
    supabaseKey: config.supabaseKey,
    getAi: () => getGeminiClient(config),
    groqApiKey: config.groqApiKey,
    googleClientId: config.googleClientId,
    googleClientSecret: config.googleClientSecret,
    googleRedirectUri: config.googleRedirectUri,
  }));
  app.use(createGoogleCalendarRouter({
    authenticateToken,
    googleClientId: config.googleClientId,
    googleClientSecret: config.googleClientSecret,
    googleRedirectUri: config.googleRedirectUri,
    jwtSecret: config.jwtSecret,
  }));
  app.use(createAdminRouter({ authenticateToken, supabase, evolutionApiUrl: config.evolutionApiUrl, evolutionApiKey: config.evolutionApiKey, publicBaseUrl: config.publicBaseUrl, sharedMetaPhoneNumberId: config.metaPhoneNumberId }));
  app.use(createRoadmapRouter({ authenticateToken }));
  app.use(createCrmRouter({ authenticateToken }));
  app.use(createFinancialRouter({ authenticateToken }));
  initWebPush({ vapidPublicKey: config.vapidPublicKey, vapidPrivateKey: config.vapidPrivateKey, vapidSubject: config.vapidSubject });
  app.use(createPushSubscriptionsRouter({ authenticateToken, vapidPublicKey: config.vapidPublicKey }));
  app.use(createQualityAuditRouter({ authenticateToken }));

  // Middleware de erro global do Express — precisa vir DEPOIS de todas as
  // rotas de API acima (é assim que o Express decide quem trata um
  // `next(err)`) e ANTES do fallback estático/SPA abaixo. Junto com
  // asyncHandler (server/middleware/asyncHandler.ts), é o que transforma um
  // erro de rota numa resposta 500 normal em vez de travar a requisição sem
  // resposta (ver process.on('unhandledRejection') acima pro contexto
  // completo do bug que isso corrige).
  app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (res.headersSent) return next(err);
    console.error(`❌ [Erro não tratado] ${req.method} ${req.path}:`, err?.stack || err?.message || err);
    notifySystemError({ source: `${req.method} ${req.path}`, message: err?.message || String(err) }).catch(() => {});
    res.status(500).json({ error: 'Erro interno do servidor.' });
  });

  // Worker em background que processa a fila de transcrição (webhook → download
  // de mídia → Gemini). Ver server/services/transcriptionQueue.ts.
  startTranscriptionWorker({
    getAi: () => getGeminiClient(config),
    groqApiKey: config.groqApiKey,
    metaAccessToken: config.metaAccessToken,
    evolutionApiUrl: config.evolutionApiUrl,
    evolutionApiKey: config.evolutionApiKey,
    evolutionInstanceName: config.evolutionInstanceName,
    metaPhoneNumberId: config.metaPhoneNumberId,
    supabaseUrl: config.supabaseUrl,
    supabaseKey: config.supabaseKey,
  });

  // Job em background que verifica a agenda real e manda lembretes de
  // WhatsApp na véspera/dia do horário marcado. Ver server/services/reminderJob.ts.
  startReminderJob({
    getCalendarConfig: () => ({
      clientId: config.googleClientId,
      clientSecret: config.googleClientSecret,
      redirectUri: config.googleRedirectUri,
    }),
    metaAccessToken: config.metaAccessToken,
    metaPhoneNumberId: config.metaPhoneNumberId,
    evolutionApiUrl: config.evolutionApiUrl,
    evolutionApiKey: config.evolutionApiKey,
    evolutionInstanceName: config.evolutionInstanceName,
  });

  // Job em background que alerta o operador quando uma pré-reserva vence
  // (data combinada chegou e ainda está pending) — nunca confirma/libera
  // nada sozinho. Ver server/services/preReservationFollowUpJob.ts.
  startPreReservationFollowUpJob();

  // Job em background que escala pro operador quando um lead esfria no meio
  // do funil — esperando avaliação da dona do negócio (foto de trabalho
  // anterior) ou sumiu depois que a IA ofereceu horário/opção. Achado real
  // (15/08/2026): auditoria de conversas do dia mostrou zero agendamentos
  // fechados apesar de dezenas de conversas ativas. Nunca reabre contato
  // sozinho, só avisa. Ver server/services/pendingFollowUpJob.ts.
  startPendingFollowUpJob();

  // Job em background que alerta o operador quando o agente automático fica
  // pausado tempo demais com lead sem resposta acumulando (issue #115) —
  // nunca reativa sozinho, só avisa. Ver server/services/agentPausedAlertJob.ts.
  startAgentPausedAlertJob({
    metaAccessToken: config.metaAccessToken,
    metaPhoneNumberId: config.metaPhoneNumberId,
    evolutionApiUrl: config.evolutionApiUrl,
    evolutionApiKey: config.evolutionApiKey,
    evolutionInstanceName: config.evolutionInstanceName,
  });

  // Job em background que alerta o operador quando um pagamento fica
  // pending_verification há mais de 2h sem ninguém confirmar/rejeitar
  // (issue #98) — nunca confirma/rejeita sozinho, só avisa. Reusa o mesmo
  // canal de alerta (push + WhatsApp) do escalonamento normal. Ver
  // server/services/paymentPendingAlertJob.ts.
  startPaymentPendingAlertJob();

  // Job em background que libera sozinho o horário de uma reserva feita por
  // criar_agendamento que nunca teve o comprovante aprovado a tempo (issue
  // #289) — sem evento real no Calendar até a aprovação, então esse horário
  // precisa reaparecer como livre pra outro cliente depois do prazo (2h).
  // Ver server/services/heldAppointmentExpiryJob.ts.
  startHeldAppointmentExpiryJob();

  // Servir Vite middleware em desenvolvimento ou arquivos estáticos em produção
  if (!config.isProduction) {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    // Express 5/path-to-regexp não aceita mais o wildcard literal `*`.
    // A expressão regular mantém o fallback GET da SPA sem depender da sintaxe
    // específica do parser de rotas.
    app.get(/.*/, spaFallbackRateLimiter, (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(config.port, '0.0.0.0', () => {
    console.log(`Servidor Universo.ai rodando na porta ${config.port}`);
  });
}

startServer();
