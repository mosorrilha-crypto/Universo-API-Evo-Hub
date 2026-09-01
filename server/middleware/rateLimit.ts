import { rateLimit } from 'express-rate-limit';

// Rate limit para as rotas que chamam o Gemini ou geram custo — protege contra
// abuso mesmo vindo de um usuário autenticado.
export const aiRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Muitas requisições. Aguarde um minuto e tente novamente.' },
});

// O fallback da SPA faz acesso ao sistema de arquivos para enviar index.html.
// Limitar somente esse caminho evita que requisições para URLs inexistentes
// provoquem leituras repetidas sem afetar os assets estáticos ou a API.
export const spaFallbackRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Muitas requisições. Aguarde um minuto e tente novamente.' },
});

// Catálogo público é leitura barata, mas precisa de limite próprio para evitar
// abuso do endpoint sem misturar o tráfego de visitantes com o fallback da SPA.
export const publicCatalogRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Muitas consultas ao catálogo. Aguarde um minuto e tente novamente.' },
});

// Interesse comercial é escrita pública e recebe limite mais conservador que
// consultas de catálogo, evitando spam sem impedir um visitante legítimo.
export const commercialInterestRateLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 8,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Muitas solicitações a partir desta conexão. Aguarde uma hora e tente novamente.' },
});


// Confirmação de sessão é chamada ao abrir o aplicativo. Limite moderado por
// IP evita abuso de validação de token sem prejudicar recargas normais.
export const authSessionRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Muitas verificações de sessão. Aguarde um minuto e tente novamente.' },
});

// Achado do CodeQL (js/missing-rate-limiting, PR #496): /connect faz
// autorização (checagem de entitlement + role admin) sem limite de
// requisições. É uma ação administrativa rara (iniciar o consentimento
// OAuth do Google Calendar); limite baixo por IP evita esgotar a rota sem
// afetar o uso legítimo.
export const googleCalendarConnectRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Muitas tentativas de conexão com o Google Calendar. Aguarde um minuto e tente novamente.' },
});

// TASK-0198 (achado do CodeQL, js/missing-rate-limiting): o callback OAuth
// do Google é uma rota PÚBLICA por natureza (o Google redireciona o
// navegador do usuário direto pra ela — não passa por authenticateToken).
// A prova de legitimidade real vem do `state` assinado (verifyOAuthState em
// googleCalendar.ts), mas nada limitava quantas vezes essa rota podia ser
// batida por IP antes disso, sem custo de autenticação nenhum.
export const googleOAuthCallbackRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Muitas tentativas de conexão. Aguarde um minuto e tente novamente.' },
});

// TASK-0198 (achado do CodeQL, js/missing-rate-limiting): GET
// /api/conversations/stream verifica o JWT manualmente (EventSource não
// manda header Authorization, então o token vem por querystring — ver
// conversations.ts) só DEPOIS de aceitar a requisição, e mantém a conexão
// SSE aberta indefinidamente. Sem limite, um IP conseguiria abrir conexões
// (válidas ou não) sem restrição nenhuma, esgotando conexões/memória do
// processo. Limite mais alto que os outros por ser uma rota que o próprio
// painel reabre em reconexões normais de rede (EventSource já reconecta
// sozinho no browser).
export const conversationsStreamRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Muitas tentativas de conexão. Aguarde um minuto e tente novamente.' },
});
