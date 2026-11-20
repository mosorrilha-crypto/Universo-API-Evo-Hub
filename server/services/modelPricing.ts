/** Tarifas de tokens verificadas em 19/11/2026 nas fontes oficiais.
 * https://ai.google.dev/gemini-api/docs/pricing
 * https://console.groq.com/docs/models
 * Estimativa parcial: não inclui armazenamento do cache, áudio Whisper,
 * ferramentas externas nem chamadas anteriores sem telemetria.
 * Linhas legadas sem modelo usam o preço histórico do provedor (aproximação).
 */
import type { LlmProvider } from './tokenUsageStore';

export interface PricingTier {
  /** Data (ISO, inclusive) a partir da qual este tier vale. */
  effectiveFrom: string;
  /** Data (ISO, exclusive) até quando este tier vale. Ausente = sem data de fim. */
  effectiveUntil?: string;
  inputPerMillionUSD: number;
  outputPerMillionUSD: number;
  /** Tokens de contexto reaproveitados via cache (subconjunto do prompt, nunca somado a ele). */
  cachedInputPerMillionUSD: number;
}

interface ModelPricing {
  model: string;
  sourceUrl: string;
  tiers: PricingTier[];
}

const PRICING: Record<LlmProvider, ModelPricing> = {
  gemini: {
    model: 'gemini-3.6-flash',
    sourceUrl: 'https://ai.google.dev/gemini-api/docs/pricing',
    tiers: [
      {
        effectiveFrom: '2000-01-01T00:00:00.000Z',
        effectiveUntil: '2027-01-01T00:00:00.000Z',
        inputPerMillionUSD: 0.75,
        outputPerMillionUSD: 3.75,
        cachedInputPerMillionUSD: 0.075,
      },
      {
        effectiveFrom: '2027-01-01T00:00:00.000Z',
        inputPerMillionUSD: 1.5,
        outputPerMillionUSD: 7.5,
        cachedInputPerMillionUSD: 0.15,
      },
    ],
  },
  groq: {
    model: 'openai/gpt-oss-20b',
    sourceUrl: 'https://console.groq.com/docs/model/openai/gpt-oss-20b (preço oficial direto da Groq)',
    tiers: [
      {
        // Sem tier antigo pra preservar: toda chamada Groq com o modelo
        // anterior (llama-3.1-8b-instant) vinha respondendo 404 desde a
        // depreciação em 16/08/2026 — recordGeminiUsage(..., 'groq') só
        // roda no caminho de sucesso (ver classifyAgent em autoReply.ts),
        // então nenhuma linha de uso real foi gravada no preço antigo.
        effectiveFrom: '2000-01-01T00:00:00.000Z',
        inputPerMillionUSD: 0.075,
        outputPerMillionUSD: 0.3,
        // Groq não oferece context caching hoje — preço de cache igual ao de input
        // pra nunca subestimar custo se um dia `cached_tokens` vier != 0 pra este provedor.
        cachedInputPerMillionUSD: 0.075,
      },
    ],
  },
};

export function isKnownUsageModel(provider: LlmProvider, model?: string | null): boolean {
  return !model || (provider === 'gemini'
    ? ['gemini-3.6-flash', 'gemini-3.5-flash-lite'].includes(model)
    : ['openai/gpt-oss-20b', 'openai/gpt-oss-120b'].includes(model));
}
function findTier(provider: LlmProvider, atISODate: string, model?: string | null): PricingTier | undefined {
  if (!isKnownUsageModel(provider, model)) return undefined;
  if (provider === 'groq' && model === 'openai/gpt-oss-120b') return { effectiveFrom: '2000-01-01', inputPerMillionUSD: 0.15, outputPerMillionUSD: 0.6, cachedInputPerMillionUSD: 0.15 };
  if (provider === 'gemini' && model === 'gemini-3.5-flash-lite') return { effectiveFrom: '2000-01-01', inputPerMillionUSD: 0.3, outputPerMillionUSD: 2.5, cachedInputPerMillionUSD: 0.03 };
  return PRICING[provider].tiers.find(
    (tier) => atISODate >= tier.effectiveFrom && (!tier.effectiveUntil || atISODate < tier.effectiveUntil)
  );
}

/**
 * Custo estimado (USD) de uma chamada, dado seu uso de tokens e a data em
 * que ocorreu (não a data de hoje — preço pode mudar entre a chamada e a
 * leitura da telemetria). `cachedTokens` é tratado como subconjunto de
 * `promptTokens` (é assim que o Gemini reporta `cachedContentTokenCount`
 * dentro de `promptTokenCount`), nunca somado a ele.
 */
export function estimateUsageCostUSD(
  provider: LlmProvider,
  promptTokens: number,
  candidatesTokens: number,
  cachedTokens: number,
  atISODate: string,
  model?: string | null
): number {
  const tier = findTier(provider, atISODate, model);
  if (!tier) return 0;
  const nonCachedInputTokens = Math.max(0, promptTokens - cachedTokens);
  const inputCost = (nonCachedInputTokens / 1_000_000) * tier.inputPerMillionUSD;
  const cacheCost = (cachedTokens / 1_000_000) * tier.cachedInputPerMillionUSD;
  const outputCost = (candidatesTokens / 1_000_000) * tier.outputPerMillionUSD;
  return inputCost + cacheCost + outputCost;
}

/** Quanto os tokens em cache economizaram (USD) frente ao preço cheio de input, na mesma data. */
export function estimateCacheSavingsUSD(provider: LlmProvider, cachedTokens: number, atISODate: string, model?: string | null): number {
  const tier = findTier(provider, atISODate, model);
  if (!tier || cachedTokens <= 0) return 0;
  return (cachedTokens / 1_000_000) * (tier.inputPerMillionUSD - tier.cachedInputPerMillionUSD);
}
