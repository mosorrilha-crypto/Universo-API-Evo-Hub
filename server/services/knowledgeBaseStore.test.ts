import { describe, expect, it } from 'vitest';
import { resolveProductAmountByName, resolveVariantPrice, resolveVariantPriceAmount, type AgentKnowledgeBase, type ProductVariant } from './knowledgeBaseStore';

const discountedVariant: ProductVariant = {
  code: 'Efecto Delineado', price: 'Gs 220.000', priceAmount: 220000,
  promoPrice: 'Gs 180.000', promoPriceAmount: 180000, promoUntil: '2026-08-31', durationMinutes: 120,
};

const kb: AgentKnowledgeBase = {
  products: [{ name: 'Pestañas', price: 'Sob consulta', variants: [discountedVariant] }],
};

describe('promoções em variações', () => {
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
