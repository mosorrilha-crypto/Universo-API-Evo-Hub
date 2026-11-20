import { createHash } from 'node:crypto';

// Não compartilha o bloqueio entre credenciais ou modelos; nunca guarda a chave em claro.
const blockedUntil = new Map<string, number>();
const keyFor = (apiKey: string, model: string) => createHash('sha256').update(apiKey).update('\0').update(model).digest('hex');
export function assertGroqAvailable(apiKey: string, model: string): void {
  const key = keyFor(apiKey, model);
  const until = blockedUntil.get(key) || 0;
  if (until > Date.now()) throw new Error(`Groq em pausa por limite de cota (${Math.ceil((until - Date.now()) / 1000)}s restantes).`);
  blockedUntil.delete(key);
}
export function rememberGroqRateLimit(apiKey: string, model: string, response: Response, body: string): void {
  if (response.status !== 429) return;
  const header = response.headers?.get('retry-after');
  let delay = header ? (Number.isFinite(Number(header)) ? Number(header) * 1000 : Date.parse(header) - Date.now()) : NaN;
  if (!Number.isFinite(delay) || delay <= 0) {
    const duration = /try again in\s+((?:[\d.]+\s*(?:ms|h|m|s)\s*)+)/i.exec(body)?.[1];
    delay = duration ? [...duration.matchAll(/([\d.]+)\s*(ms|h|m|s)/g)].reduce((sum, match) => sum + Number(match[1]) * ({ ms: 1, s: 1000, m: 60000, h: 3600000 }[match[2]] || 0), 0) : 60000;
  }
  const now = Date.now();
  for (const [key, until] of blockedUntil) if (until <= now) blockedUntil.delete(key);
  // Limite de memória em processos duradouros; evicção só perde a otimização.
  if (blockedUntil.size >= 256) blockedUntil.delete(blockedUntil.keys().next().value!);
  const key = keyFor(apiKey, model);
  blockedUntil.set(key, Math.max(blockedUntil.get(key) || 0, now + Math.min(Math.max(delay, 1000), 86400000)));
}

/** Limpeza para testes isolados; não usada no fluxo de produção. */
export function resetGroqRateLimitsForTests(): void { blockedUntil.clear(); }
