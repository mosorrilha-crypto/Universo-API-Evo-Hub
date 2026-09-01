import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resolveProductAmountByName, resolveVariantPrice, resolveVariantPriceAmount, type AgentKnowledgeBase, type ProductVariant } from './knowledgeBaseStore';

// TASK-0182 — achado real: `promoUntil: '2026-08-31'` era "vigente" só enquanto
// a suíte rodasse antes dessa data. A partir de 01/09/2026 o CI quebrou
// sozinho (mesma classe de bug já visto em AgendaFinanceiroCenter — data
// hardcoded que expira/coincide com o dia real da execução). Fixar "hoje" via
// fake timer deixa o teste determinístico pra sempre, em vez de reescrever a
// data toda vez que ela vencer de novo.
const discountedVariant: ProductVariant = {
  code: 'Efecto Delineado', price: 'Gs 220.000', priceAmount: 220000,
  promoPrice: 'Gs 180.000', promoPriceAmount: 180000, promoUntil: '2026-08-31', durationMinutes: 120,
};

const kb: AgentKnowledgeBase = {
  products: [{ name: 'Pestañas', price: 'Sob consulta', variants: [discountedVariant] }],
};

describe('promoções em variações', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-15T12:00:00Z'));
  });

  afterEach(() => vi.useRealTimers());

  it('usa a promoção vigente da variação no preço exibido e no valor financeiro', () => {
    expect(resolveVariantPrice(discountedVariant, 'America/Asuncion')).toBe('Gs 180.000');
    expect(resolveVariantPriceAmount(discountedVariant, 'America/Asuncion')).toBe(180000);
    expect(resolveProductAmountByName(kb, 'Efecto Delineado', 'America/Asuncion')).toBe(180000);
  });

  it('retorna ao preço regular depois do vencimento', () => {
    const expired = { ...discountedVariant, promoUntil: '2020-01-01' };
    expect(resolveVariantPrice(expired, 'America/Asuncion')).toBe('Gs 220.000');
    expect(resolveVariantPriceAmount(expired, 'America/Asuncion')).toBe(220000);
  });
});
