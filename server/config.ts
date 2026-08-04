import crypto from 'crypto';

export interface ServerConfig {
  port: number;
  isProduction: boolean;
  demoMode: boolean;
  jwtSecret: string;
  supabaseUrl?: string;
  supabaseKey?: string;
  evohubApiKey?: string;
  metaWebhookVerifyToken: string;
  geminiApiKey?: string;
}

/**
 * Lê e valida as variáveis de ambiente na subida do servidor. Segredos
 * obrigatórios (JWT_SECRET, META_WEBHOOK_VERIFY_TOKEN) travam o boot em
 * produção se ausentes; fora de produção, geram um valor efêmero com aviso
 * para não travar o preview/demo.
 */
export function loadConfig(): ServerConfig {
  const isProduction = process.env.NODE_ENV === 'production';
  const port = Number(process.env.PORT) || 3000;

  let jwtSecret = process.env.JWT_SECRET;
  if (!jwtSecret) {
    if (isProduction) {
      throw new Error('JWT_SECRET é obrigatória em produção. Configure-a no .env (veja .env.example).');
    }
    jwtSecret = crypto.randomBytes(32).toString('hex');
    console.warn('⚠️  JWT_SECRET não configurada — usando um segredo temporário só para esta execução (dev only).');
  }

  // DEMO_MODE: fora de produção, ligado por padrão (facilita testar sem backend
  // completo). Em produção, desligado por padrão — só liga com DEMO_MODE=true
  // explícito. Controla o login com senhas fixas e o endpoint de token demo.
  const demoMode = process.env.DEMO_MODE === 'true' ? true
    : process.env.DEMO_MODE === 'false' ? false
    : !isProduction;

  let metaWebhookVerifyToken = process.env.META_WEBHOOK_VERIFY_TOKEN;
  if (!metaWebhookVerifyToken) {
    if (isProduction) {
      throw new Error('META_WEBHOOK_VERIFY_TOKEN é obrigatória em produção para validar o webhook da Meta.');
    }
    metaWebhookVerifyToken = crypto.randomBytes(16).toString('hex');
    console.warn('⚠️  META_WEBHOOK_VERIFY_TOKEN não configurada — usando um valor temporário (dev only), a integração real com a Meta não vai funcionar até configurar um token fixo.');
  }

  const evohubApiKey = process.env.EVOHUB_API_KEY;
  if (!evohubApiKey && !isProduction) {
    console.warn('⚠️  EVOHUB_API_KEY não configurada — rotas /api/v1/* do Evo Hub aceitam qualquer chamada (dev only).');
  }

  return {
    port,
    isProduction,
    demoMode,
    jwtSecret,
    supabaseUrl: process.env.SUPABASE_URL,
    supabaseKey: process.env.SUPABASE_KEY,
    evohubApiKey,
    metaWebhookVerifyToken,
    geminiApiKey: process.env.GEMINI_API_KEY,
  };
}
