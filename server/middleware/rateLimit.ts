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
