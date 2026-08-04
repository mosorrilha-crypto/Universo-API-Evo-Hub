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
