import { describe, expect, it } from 'vitest';
import { estimateUsageCostUSD, estimateCacheSavingsUSD } from '../modelPricing';

describe('estimateUsageCostUSD', () => {
  it('gemini: cobra tokens não-cacheados a preço de input, tokens cacheados a preço de cache, saída a preço de output', () => {
    // Tier promocional (até 31/12/2026): input $0.75/1M, output $3.75/1M, cache $0.075/1M.
    const cost = estimateUsageCostUSD('gemini', 1_000_000, 1_000_000, 500_000, '2026-08-18T00:00:00.000Z');
    // 500k não-cacheados a 0.75 + 500k cacheados a 0.075 + 1M output a 3.75
    expect(cost).toBeCloseTo(0.375 + 0.0375 + 3.75, 8);
  });

  it('gemini: aplica o tier de preço padrão (dobrado) a partir de 01/01/2027', () => {
    const cost = estimateUsageCostUSD('gemini', 1_000_000, 0, 0, '2027-01-01T00:00:00.000Z');
    expect(cost).toBeCloseTo(1.5, 8);
  });

  it('groq: sem context caching real ainda — cached_tokens=0 não afeta o custo', () => {
    const cost = estimateUsageCostUSD('groq', 1_000_000, 1_000_000, 0, '2026-08-18T00:00:00.000Z');
    expect(cost).toBeCloseTo(0.075 + 0.3, 8);
  });

  it('nunca fica negativo mesmo se cached_tokens > prompt_tokens (dado inconsistente)', () => {
    const cost = estimateUsageCostUSD('gemini', 100, 0, 500, '2026-08-18T00:00:00.000Z');
    expect(cost).toBeGreaterThanOrEqual(0);
  });
});

describe('estimateCacheSavingsUSD', () => {
  it('gemini: economia é a diferença entre preço de input cheio e preço de cache', () => {
    const savings = estimateCacheSavingsUSD('gemini', 1_000_000, '2026-08-18T00:00:00.000Z');
    expect(savings).toBeCloseTo(0.75 - 0.075, 8);
  });

  it('sem tokens cacheados, economia é zero', () => {
    expect(estimateCacheSavingsUSD('gemini', 0, '2026-08-18T00:00:00.000Z')).toBe(0);
  });
});
