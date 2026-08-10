import express from 'express';
import path from 'path';
import dotenv from 'dotenv';
import { createServer as createViteServer } from 'vite';

import { loadConfig } from './server/config';
import { createSupabaseClientFromConfig } from './server/supabaseClient';
import { getGeminiClient } from './server/gemini';
import { createAuthenticateToken } from './server/middleware/auth';
import { aiRateLimiter } from './server/middleware/rateLimit';
import { createAuthenticateEvoHub } from './server/middleware/evoHubAuth';
import { createAuthRouter } from './server/routes/auth';
import { createAiRouter } from './server/routes/ai';
import { createTelemetryRouter } from './server/routes/telemetry';
import { createWebhooksRouter } from './server/routes/webhooks';
import { createMetaCapiRouter } from './server/routes/metaCapi';
import { createEvoHubRouter } from './server/routes/evoHub';
import { createConversationsRouter } from './server/routes/conversations';
import { createGoogleCalendarRouter } from './server/routes/googleCalendar';
import { createAdminRouter } from './server/routes/admin';
import { createCrmRouter } from './server/routes/crm';
import { startTranscriptionWorker } from './server/services/transcriptionQueue';
import { initDb } from './server/services/db';
import { startReminderJob } from './server/services/reminderJob';
import { startPreReservationFollowUpJob } from './server/services/preReservationFollowUpJob';
import { startAgentPausedAlertJob } from './server/services/agentPausedAlertJob';

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
  console.error('🔥 [unhandledRejection] Erro não tratado — processo continua vivo:', reason instanceof Error ? reason.stack || reason.message : reason);
});
process.on('uncaughtException', (err) => {
  console.error('🔥 [uncaughtException] Erro não tratado — processo continua vivo:', err.stack || err.message);
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
  const authenticateEvoHub = createAuthenticateEvoHub(config.evohubApiKey, config.isProduction);

  // Os 8 serviços (Bloco 2.A) leem/escrevem em tabelas Postgres reais
  // através deste único cliente Supabase compartilhado — nada mais fica em
  // memória ou em JSON solto no Storage.
  initDb(supabase);
  if (!supabase) {
    console.warn('⚠️  SUPABASE_URL/SUPABASE_KEY ausentes — conversas, agenda, base de conhecimento e login real não vão funcionar até configurar.');
  }

  app.use(express.json({
    limit: '50mb',
    verify: (req: any, _res, buf) => {
      req.rawBody = buf;
    }
  }));
  app.use(express.urlencoded({ limit: '50mb', extended: true }));

  app.use(createAuthRouter({ jwtSecret: config.jwtSecret, supabase }));
  app.use(createAiRouter({ config, authenticateToken, rateLimiter: aiRateLimiter }));
  app.use(createTelemetryRouter({ authenticateToken }));
  app.use(createWebhooksRouter({
    metaWebhookVerifyToken: config.metaWebhookVerifyToken,
    evoHubWebhookSecret: config.evoHubWebhookSecret,
    getAi: () => getGeminiClient(config),
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
  app.use(createEvoHubRouter({ authenticateEvoHub }));
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
  }));
  app.use(createGoogleCalendarRouter({
    authenticateToken,
    googleClientId: config.googleClientId,
    googleClientSecret: config.googleClientSecret,
    googleRedirectUri: config.googleRedirectUri,
    jwtSecret: config.jwtSecret,
  }));
  app.use(createAdminRouter({ authenticateToken, supabase, evolutionApiUrl: config.evolutionApiUrl, evolutionApiKey: config.evolutionApiKey }));
  app.use(createCrmRouter({ authenticateToken }));

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
    res.status(500).json({ error: 'Erro interno do servidor.' });
  });

  // Worker em background que processa a fila de transcrição (webhook → download
  // de mídia → Gemini). Ver server/services/transcriptionQueue.ts.
  startTranscriptionWorker({
    getAi: () => getGeminiClient(config),
    metaAccessToken: config.metaAccessToken,
    evolutionApiUrl: config.evolutionApiUrl,
    evolutionApiKey: config.evolutionApiKey,
    evolutionInstanceName: config.evolutionInstanceName,
    evoHubApiUrl: config.evoHubApiUrl,
    evoHubChannelToken: config.evoHubChannelToken,
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

  // Job em background que alerta o operador quando o agente automático fica
  // pausado tempo demais com lead sem resposta acumulando (issue #115) —
  // nunca reativa sozinho, só avisa. Ver server/services/agentPausedAlertJob.ts.
  startAgentPausedAlertJob({
    metaAccessToken: config.metaAccessToken,
    metaPhoneNumberId: config.metaPhoneNumberId,
  });

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
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(config.port, '0.0.0.0', () => {
    console.log(`Servidor Universo.ai rodando na porta ${config.port}`);
  });
}

startServer();
