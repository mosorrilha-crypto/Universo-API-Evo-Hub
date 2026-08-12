import crypto from 'crypto';

export interface ServerConfig {
  port: number;
  isProduction: boolean;
  jwtSecret: string;
  supabaseUrl?: string;
  supabaseKey?: string;
  evohubApiKey?: string;
  metaWebhookVerifyToken: string;
  geminiApiKey?: string;
  /** Token de acesso à Graph API pra baixar mídia (diferente do META_APP_SECRET usado no HMAC). */
  metaAccessToken?: string;
  /** ID do número de telefone WhatsApp (Meta Cloud API), usado pra enviar mensagens (POST /{id}/messages). */
  metaPhoneNumberId?: string;
  evolutionApiUrl?: string;
  evolutionApiKey?: string;
  evolutionInstanceName?: string;
  /** URL pública deste próprio backend — usada pra registrar o webhook de uma instância Evolution API recém-criada (Epic 4.6) apontando de volta pra cá. */
  publicBaseUrl: string;
  /** URL base da API real do Evo Hub (api.evohub.ai) — não confundir com evohubApiKey acima. */
  evoHubApiUrl: string;
  /** Chave de conta (evh_pk_...) pra chamar a API do Evo Hub (criar canal, credenciais BYO etc.). */
  evoHubAccountApiKey?: string;
  /** Segredo escolhido por nós ao criar o canal, usado pelo Hub pra assinar X-Hub-Signature-256. */
  evoHubWebhookSecret?: string;
  /** Token do canal específico, usado pra autenticar no proxy de mídia /meta/* do Hub. */
  evoHubChannelToken?: string;
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

  const evohubApiKey = process.env.EVOHUB_API_KEY;
  if (!evohubApiKey && !isProduction) {
    console.warn('⚠️  EVOHUB_API_KEY não configurada — rotas /api/v1/* do Evo Hub aceitam qualquer chamada (dev only).');
  }

  if (!process.env.EVO_HUB_WEBHOOK_SECRET && !isProduction) {
    console.warn('⚠️  EVO_HUB_WEBHOOK_SECRET não configurado — /api/webhooks/evohub aceita chamadas sem verificar assinatura (dev only).');
  }

  if (!process.env.VAPID_PUBLIC_KEY || !process.env.VAPID_PRIVATE_KEY) {
    console.warn('⚠️  VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY não configuradas — push notification do PWA fica desativado até gerar um par de chaves (npx web-push generate-vapid-keys) e configurar as duas.');
  }

  return {
    port,
    isProduction,
    jwtSecret,
    supabaseUrl: process.env.SUPABASE_URL,
    supabaseKey: process.env.SUPABASE_KEY,
    evohubApiKey,
    metaWebhookVerifyToken,
    geminiApiKey: process.env.GEMINI_API_KEY,
    metaAccessToken: process.env.META_ACCESS_TOKEN,
    metaPhoneNumberId: process.env.META_PHONE_NUMBER_ID,
    evolutionApiUrl: process.env.EVOLUTION_API_URL,
    evolutionApiKey: process.env.EVOLUTION_API_KEY,
    evolutionInstanceName: process.env.EVOLUTION_INSTANCE_NAME,
    publicBaseUrl: process.env.PUBLIC_BASE_URL || 'https://universo-api-evo-hub.onrender.com',
    evoHubApiUrl: process.env.EVO_HUB_API_URL || 'https://api.evohub.ai',
    evoHubAccountApiKey: process.env.EVO_HUB_ACCOUNT_API_KEY,
    evoHubWebhookSecret: process.env.EVO_HUB_WEBHOOK_SECRET,
    evoHubChannelToken: process.env.EVO_HUB_CHANNEL_TOKEN,
    googleClientId: process.env.GOOGLE_CLIENT_ID,
    googleClientSecret: process.env.GOOGLE_CLIENT_SECRET,
    googleRedirectUri: process.env.GOOGLE_REDIRECT_URI || 'https://universo-api-evo-hub.onrender.com/api/google-calendar/oauth-callback',
    vapidPublicKey: process.env.VAPID_PUBLIC_KEY,
    vapidPrivateKey: process.env.VAPID_PRIVATE_KEY,
    vapidSubject: process.env.VAPID_SUBJECT || 'mailto:suporte@universo.ai',
  };
}
