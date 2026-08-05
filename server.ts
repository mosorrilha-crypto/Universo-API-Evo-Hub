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
import { startTranscriptionWorker } from './server/services/transcriptionQueue';
import { initConversationPersistence } from './server/services/conversationStore';
import { initAgentStatusPersistence } from './server/services/agentStatus';

dotenv.config();

async function startServer() {
  const config = loadConfig();
  const app = express();

  const supabase = createSupabaseClientFromConfig(config);
  const authenticateToken = createAuthenticateToken(config.jwtSecret);
  const authenticateEvoHub = createAuthenticateEvoHub(config.evohubApiKey, config.isProduction);

  await initConversationPersistence(config.supabaseUrl, config.supabaseKey);
  await initAgentStatusPersistence(config.supabaseUrl, config.supabaseKey);

  app.use(express.json({
    limit: '50mb',
    verify: (req: any, _res, buf) => {
      req.rawBody = buf;
    }
  }));
  app.use(express.urlencoded({ limit: '50mb', extended: true }));

  app.use(createAuthRouter({ jwtSecret: config.jwtSecret, demoMode: config.demoMode, supabase }));
  app.use(createAiRouter({ config, authenticateToken, rateLimiter: aiRateLimiter }));
  app.use(createTelemetryRouter({ authenticateToken, rateLimiter: aiRateLimiter }));
  app.use(createWebhooksRouter({
    metaWebhookVerifyToken: config.metaWebhookVerifyToken,
    evoHubWebhookSecret: config.evoHubWebhookSecret,
    getAi: () => getGeminiClient(config),
    metaAccessToken: config.metaAccessToken,
    metaPhoneNumberId: config.metaPhoneNumberId,
  }));
  app.use(createMetaCapiRouter({ authenticateToken }));
  app.use(createEvoHubRouter({ authenticateEvoHub }));
  app.use(createConversationsRouter({
    authenticateToken,
    metaAccessToken: config.metaAccessToken,
    metaPhoneNumberId: config.metaPhoneNumberId,
  }));

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
