import type { GoogleGenAI } from '@google/genai';
import crypto from 'crypto';

/**
 * Cache de contexto real do Gemini (Explicit Context Caching) pra Camada
 * 1+2 do prompt (`systemInstruction` em autoReply.ts) — regra global +
 * regra do segmento, que é IDÊNTICA em quase toda chamada de um mesmo par
 * (agent, segment), mas até 14/08/2026 era reenviada por inteiro em toda
 * mensagem. Achado numa auditoria: o painel "Telemetria de Tokens IA" já
 * tinha um card "Tokens Economizados (Cache)" e um badge "Context Cache"
 * há tempos, mas sempre mostrava 0 — a funcionalidade nunca tinha sido
 * implementada de verdade, só o nome existia na tela.
 *
 * Guarda em memória (mesmo padrão já usado em transcriptionQueue.ts —
 * single-instance, não sobrevive a um restart, aceitável pro volume atual)
 * o nome do cache ativo por (agent, segment) + hash do texto cacheado, pra
 * nunca servir uma regra desatualizada depois de uma edição no prompt
 * global (ver invalidateAllSystemInstructionCaches, chamada por
 * globalPromptStore.setGlobalPromptLayer).
 *
 * Nunca bloqueia nem quebra o fluxo real do agente: qualquer falha ao
 * criar/reusar o cache (rede, conteúdo abaixo do mínimo cacheável da API,
 * o que for) cai pro comportamento de sempre — `systemInstruction` inline
 * na chamada, sem cache — a resposta ao cliente não pode depender disso
 * dar certo.
 */

interface CacheEntry {
  name: string;
  contentHash: string;
  expiresAt: number;
}

const cacheByKey = new Map<string, CacheEntry>();

/** Abaixo de 1h (limite real de expiração do lado da API) — deixa o cache se renovar sozinho mesmo se a invalidação explícita falhar por algum motivo. */
const CACHE_TTL_SECONDS = 55 * 60;

function hashContent(text: string): string {
  return crypto.createHash('sha256').update(text).digest('hex');
}

/**
 * Devolve o `name` de um cache de contexto válido pro texto informado, ou
 * `null` se não foi possível usar cache (nesse caso, quem chama deve
 * mandar `systemInstruction` normalmente, como sempre fez).
 */
export async function getCachedSystemInstruction(
  ai: GoogleGenAI,
  model: string,
  cacheKey: string,
  systemInstruction: string
): Promise<string | null> {
  const contentHash = hashContent(systemInstruction);
  const existing = cacheByKey.get(cacheKey);
  if (existing && existing.contentHash === contentHash && existing.expiresAt > Date.now()) {
    return existing.name;
  }

  try {
    const cached = await ai.caches.create({
      model,
      config: {
        systemInstruction,
        ttl: `${CACHE_TTL_SECONDS}s`,
        displayName: cacheKey,
      },
    });
    if (!cached.name) return null;
    cacheByKey.set(cacheKey, { name: cached.name, contentHash, expiresAt: Date.now() + CACHE_TTL_SECONDS * 1000 });
    return cached.name;
  } catch (err) {
    console.warn(
      `⚠️  [Gemini Cache] falha ao criar cache de contexto pra "${cacheKey}" — seguindo sem cache (mesmo comportamento de antes):`,
      (err as Error)?.message || err
    );
    cacheByKey.delete(cacheKey);
    return null;
  }
}

/**
 * Limpa todos os caches em memória — chamado quando o prompt global
 * (Camada 1) muda de verdade (setGlobalPromptLayer), pra próxima chamada
 * de cada (agent, segment) recriar o cache já com o texto novo. Sem isso,
 * uma correção urgente no prompt global (ex: as duas rodadas de correção
 * de alucinação de mídia desta mesma sessão) só valeria depois do cache
 * antigo expirar sozinho (até 55 min) em vez de imediatamente.
 */
export function invalidateAllSystemInstructionCaches(): void {
  cacheByKey.clear();
}
