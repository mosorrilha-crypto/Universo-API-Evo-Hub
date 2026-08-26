import crypto from 'crypto';

export interface ServerConfig {
  port: number;
  isProduction: boolean;
  jwtSecret: string;
  supabaseUrl?: string;
  /** Chave secreta de plataforma, restrita a manutenção e operações cross-tenant explícitas. */
  supabaseKey?: string;
  /** Chave pública usada pelo cliente runtime que passa pelas policies RLS. */
  supabasePublishableKey?: string;
  /** Segredo de assinatura para emitir JWTs curtos com claims de tenant ao PostgREST. */
  supabaseJwtSecret?: string;
  /** Verdadeiro somente quando o runtime pode acessar dados sem BYPASSRLS. */
  rlsEnforced: boolean;
  metaWebhookVerifyToken: string;
  /** Segredo do App Meta usado para validar HMAC dos POSTs de webhook. Obrigatório em produção. */
  metaAppSecret?: string;
  geminiApiKey?: string;
  /** Chave do Groq — primeira tentativa (mais barata/rápida) na classificação do router; sem ela, o router usa só o Gemini como sempre. */
  groqApiKey?: string;
  /** Token de acesso à Graph API pra baixar mídia (diferente do META_APP_SECRET usado no HMAC). */
  metaAccessToken?: string;
  /** ID do número de telefone WhatsApp (Meta Cloud API), usado pra enviar mensagens (POST /{id}/messages). */
  metaPhoneNumberId?: string;
  evolutionApiUrl?: string;
  evolutionApiKey?: string;
  evolutionInstanceName?: string;
  /** URL pública deste próprio backend — usada pra registrar o webhook de uma instância Evolution API recém-criada (Epic 4.6) apontando de volta pra cá. */
  publicBaseUrl: string;
  googleClientId?: string;
  googleClientSecret?: string;
  googleRedirectUri: string;
  /** Chave pública VAPID (Web Push) — exposta ao frontend via endpoint, não é segredo. */
  vapidPublicKey?: string;
  /** Chave privada VAPID — assina o envio real de push, nunca sai do backend. */
  vapidPrivateKey?: string;
  /** mailto: exigido pelo protocolo Web Push (identifica o remetente pro serviço de push do navegador). */
  vapidSubject: string;
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

  let metaWebhookVerifyToken = process.env.META_WEBHOOK_VERIFY_TOKEN;
  if (!metaWebhookVerifyToken) {
    if (isProduction) {
      throw new Error('META_WEBHOOK_VERIFY_TOKEN é obrigatória em produção para validar o webhook da Meta.');
    }
    metaWebhookVerifyToken = crypto.randomBytes(16).toString('hex');
    console.warn('⚠️  META_WEBHOOK_VERIFY_TOKEN não configurada — usando um valor temporário (dev only), a integração real com a Meta não vai funcionar até configurar um token fixo.');
  }

  const metaAppSecret = process.env.META_APP_SECRET;
  if (!metaAppSecret) {
    if (isProduction) {
      throw new Error('META_APP_SECRET é obrigatória em produção para validar a assinatura dos webhooks Meta.');
    }
    console.warn('⚠️  META_APP_SECRET não configurada — validação HMAC de webhooks Meta fica desativada somente em desenvolvimento.');
  }

  if (!process.env.VAPID_PUBLIC_KEY || !process.env.VAPID_PRIVATE_KEY) {
    console.warn('⚠️  VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY não configuradas — push notification do PWA fica desativado até gerar um par de chaves (npx web-push generate-vapid-keys) e configurar as duas.');
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_KEY;
  const supabasePublishableKey = process.env.SUPABASE_PUBLISHABLE_KEY;
  const supabaseJwtSecret = process.env.SUPABASE_JWT_SECRET;
  const rlsEnforced = Boolean(supabaseUrl && supabaseKey && supabasePublishableKey && supabaseJwtSecret);

  // A chave secreta de plataforma ignora RLS. Em produção, iniciar sem o
  // cliente runtime assinado reintroduziria exatamente o bypass que esta
  // correção elimina, então falhamos cedo em vez de degradar silenciosamente.
  if (supabaseUrl && supabaseKey && !rlsEnforced) {
    const message = 'SUPABASE_PUBLISHABLE_KEY e SUPABASE_JWT_SECRET são obrigatórias junto de SUPABASE_URL/SUPABASE_KEY para que o runtime respeite RLS.';
    if (isProduction) throw new Error(message);
    console.warn(`⚠️  ${message} Desenvolvimento seguirá com acesso de plataforma; RLS efetivo permanece desativado neste ambiente.`);
  }

  return {
    port,
    isProduction,
    jwtSecret,
    supabaseUrl,
    supabaseKey,
    supabasePublishableKey,
    supabaseJwtSecret,
    rlsEnforced,
    metaWebhookVerifyToken,
    metaAppSecret,
    geminiApiKey: process.env.GEMINI_API_KEY,
    groqApiKey: process.env.GROQ_API_KEY,
    metaAccessToken: process.env.META_ACCESS_TOKEN,
    metaPhoneNumberId: process.env.META_PHONE_NUMBER_ID,
    evolutionApiUrl: process.env.EVOLUTION_API_URL,
    evolutionApiKey: process.env.EVOLUTION_API_KEY,
    evolutionInstanceName: process.env.EVOLUTION_INSTANCE_NAME,
    publicBaseUrl: process.env.PUBLIC_BASE_URL || 'https://universo-api-evo-hub.onrender.com',
    googleClientId: process.env.GOOGLE_CLIENT_ID,
    googleClientSecret: process.env.GOOGLE_CLIENT_SECRET,
    googleRedirectUri: process.env.GOOGLE_REDIRECT_URI || 'https://universo-api-evo-hub.onrender.com/api/google-calendar/oauth-callback',
    vapidPublicKey: process.env.VAPID_PUBLIC_KEY,
    vapidPrivateKey: process.env.VAPID_PRIVATE_KEY,
    vapidSubject: process.env.VAPID_SUBJECT || 'mailto:suporte@universo.ai',
  };
}
