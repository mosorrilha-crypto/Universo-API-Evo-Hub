import { createHash } from 'node:crypto';

/**
 * Bloqueio de login por CONTA (não por IP) — achado real (02/09/2026,
 * auditoria de segurança comparando com o DeskcommCRM): `POST /api/auth/login`
 * não tinha nenhum limite de tentativas, nem por IP nem por conta — um
 * atacante podia tentar senhas ilimitadas contra qualquer e-mail conhecido.
 *
 * Duas defesas complementares, como no rate limit de IP já existente em
 * outras rotas (`server/middleware/rateLimit.ts`):
 *  - por IP (rateLimit.ts): barra quem varre muitas contas de um lugar só.
 *  - por CONTA (este arquivo): barra o ataque distribuído contra UMA conta,
 *    que o limite por IP não vê — funciona mesmo se o atacante rotacionar IP.
 *
 * Em memória do processo — mesma limitação já documentada em
 * `idempotency.ts` (não sobrevive a restart, não é compartilhado entre
 * instâncias). Aceitável aqui pelo mesmo motivo: o pior caso de uma falha
 * dessa defesa é voltar ao estado atual (sem limite por conta), nunca um
 * bloqueio permanente de usuário legítimo.
 *
 * Conta pelo FRACASSO, não pela tentativa: quem acerta a senha não gasta o
 * próprio orçamento de bloqueio. A consulta (`isLoginLocked`) roda ANTES da
 * verificação de senha, e o incremento (`recordFailedLogin`) só DEPOIS de
 * confirmar que a senha errou — assim N tentativas erradas trancam a conta
 * pela janela inteira, e acertar de primeira nunca conta contra o limite.
 */

const MAX_FAILED_ATTEMPTS = 5;
const WINDOW_MS = 15 * 60 * 1000;

interface AttemptState {
  count: number;
  windowStartedAt: number;
}

const attemptsByEmail = new Map<string, AttemptState>();

/** E-mail nunca fica em texto plano na chave do mapa — mesmo padrão de opacidade do rate limit de IP. */
function opaque(email: string): string {
  return createHash('sha256').update(email.trim().toLowerCase()).digest('hex');
}

function currentState(key: string): AttemptState | undefined {
  const state = attemptsByEmail.get(key);
  if (!state) return undefined;
  if (Date.now() - state.windowStartedAt > WINDOW_MS) {
    attemptsByEmail.delete(key);
    return undefined;
  }
  return state;
}

export function isLoginLocked(email: string): boolean {
  const state = currentState(opaque(email));
  return !!state && state.count >= MAX_FAILED_ATTEMPTS;
}

export function recordFailedLogin(email: string): void {
  const key = opaque(email);
  const state = currentState(key);
  if (state) {
    state.count += 1;
  } else {
    attemptsByEmail.set(key, { count: 1, windowStartedAt: Date.now() });
  }
}

/** Chamado em todo login bem-sucedido — acertar a senha zera o histórico de falhas daquela conta. */
export function clearFailedLogins(email: string): void {
  attemptsByEmail.delete(opaque(email));
}

/** Exportado exclusivamente para testes, para evitar estado residual entre casos. */
export function resetAuthLoginAttemptsForTests(): void {
  attemptsByEmail.clear();
}
