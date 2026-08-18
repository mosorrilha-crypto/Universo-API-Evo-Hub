/**
 * Pricing Engine — preço confirmado por 1M tokens, por provedor. Antes desta
 * issue, `getTokenTelemetry()` sempre devolvia `totalSaaSCostUSD: 0` porque
 * não existia preço confiável pro modelo em uso (CLAUDE.md: "AI fallbacks
 * never fabricate business data" — vale pra dado de custo tanto quanto pra
 * resposta do agente, um custo estimado sem fonte real é dado de negócio
 * inventado). O painel mostrava "—" no card "Custo Estimado Gemini API" em
 * vez de um número fabricado.
 *
 * Fontes checadas em 18/08/2026:
 * - Gemini 3.6 Flash (`server/services/autoReply.ts`, único modelo Gemini
 *   usado hoje): https://ai.google.dev/gemini-api/docs/pricing — preço
 *   promocional vigente até 31/12/2026, dobra em 01/01/2027. Os dois tiers
 *   estão registrados abaixo; a chamada é resolvida pela data de cada linha
 *   de uso, nunca pela data de hoje.
 * - Groq openai/gpt-oss-20b (`server/services/groqClient.ts`, único modelo
 *   Groq usado hoje — trocado em 18/08/2026: llama-3.1-8b-instant, o modelo
 *   anterior, foi descontinuado pela Groq em 16/08/2026 e toda chamada
 *   vinha respondendo 404 há dois dias, sempre caindo pro Gemini sem
 *   nenhum aviso visível — ver comentário em groqClient.ts): preço oficial
 *   direto da Groq, $0.075 / $0.30 por 1M tokens (input/output).
 *
 * Se o modelo usado em `autoReply.ts`/`groqClient.ts` mudar, este arquivo
 * precisa ser atualizado junto — o preço aqui é específico do modelo, não
 * do provedor em geral.
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

function findTier(provider: LlmProvider, atISODate: string): PricingTier | undefined {
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
  atISODate: string
): number {
  const tier = findTier(provider, atISODate);
  if (!tier) return 0;
  const nonCachedInputTokens = Math.max(0, promptTokens - cachedTokens);
  const inputCost = (nonCachedInputTokens / 1_000_000) * tier.inputPerMillionUSD;
  const cacheCost = (cachedTokens / 1_000_000) * tier.cachedInputPerMillionUSD;
  const outputCost = (candidatesTokens / 1_000_000) * tier.outputPerMillionUSD;
  return inputCost + cacheCost + outputCost;
}

/** Quanto os tokens em cache economizaram (USD) frente ao preço cheio de input, na mesma data. */
export function estimateCacheSavingsUSD(provider: LlmProvider, cachedTokens: number, atISODate: string): number {
  const tier = findTier(provider, atISODate);
  if (!tier || cachedTokens <= 0) return 0;
  return (cachedTokens / 1_000_000) * (tier.inputPerMillionUSD - tier.cachedInputPerMillionUSD);
}
