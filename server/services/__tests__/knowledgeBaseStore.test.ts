/**
 * Achado numa auditoria pós-lançamento: formatKnowledgeBaseForPrompt nunca
 * lia kb.businessModel — endereço, horário em texto e Instagram nunca
 * chegavam no prompt do Gemini, quebrando perguntas de FAQ reais tipo
 * "a que horas abrem?"/"onde fica?".
 */
import { describe, expect, it } from 'vitest';
import {
  formatKnowledgeBaseForPrompt,
  resolveProductPriceAmount,
  isNonBookableProduct,
  findProductDurationMinutes,
  type AgentKnowledgeBase,
  type AgentProduct,
} from '../knowledgeBaseStore';

describe('formatKnowledgeBaseForPrompt', () => {
  it('inclui businessModel (endereço/horário/posicionamento) no texto do prompt', () => {
    const kb: AgentKnowledgeBase = {
      companyName: 'Estúdio Teste',
      businessModel: 'Luque, Paraguai. Horário: segunda a sexta 07:30–20:00. Instagram: @teste',
    };
    const text = formatKnowledgeBaseForPrompt(kb);
    expect(text).toContain('Luque, Paraguai');
    expect(text).toContain('07:30–20:00');
    expect(text).toContain('@teste');
  });

  it('não quebra quando businessModel está ausente', () => {
    const kb: AgentKnowledgeBase = { companyName: 'Estúdio Teste' };
    expect(() => formatKnowledgeBaseForPrompt(kb)).not.toThrow();
  });
});

/**
 * Etapa 2 do roadmap (preço/duração numéricos, retoque não-agendável) —
 * achado numa auditoria externa: preço/duração em texto livre dificultava
 * cálculo real (Meta CAPI, saldo da seña, fim do evento no Google Calendar),
 * e nada impedia a IA de agendar um item como "Retoque", que só Monique
 * decide depois de avaliar o resultado.
 */
describe('resolveProductPriceAmount', () => {
  it('prefere priceAmount estruturado em vez de parsear price em texto', () => {
    const product: AgentProduct = { name: 'Microlips', price: 'Gs 500.000', priceAmount: 500000 };
    expect(resolveProductPriceAmount(product)).toBe(500000);
  });

  it('cai pro parsing de price em texto quando priceAmount não está preenchido (catálogo legado)', () => {
    const product: AgentProduct = { name: 'Plano Pro', price: 'R$ 690 / mês' };
    expect(resolveProductPriceAmount(product)).toBe(690);
  });

  it('usa promoPriceAmount quando dentro da validade', () => {
    const product: AgentProduct = { name: 'Microlips', price: 'Gs 500.000', priceAmount: 500000, promoPriceAmount: 450000, promoUntil: '2099-01-01' };
    expect(resolveProductPriceAmount(product)).toBe(450000);
  });

  it('ignora promoPriceAmount vencido e usa o preço regular', () => {
    const product: AgentProduct = { name: 'Microlips', price: 'Gs 500.000', priceAmount: 500000, promoPriceAmount: 450000, promoUntil: '2020-01-01' };
    expect(resolveProductPriceAmount(product)).toBe(500000);
  });
});

describe('isNonBookableProduct', () => {
  it('true quando o produto está marcado bookable:false (ex: Retoque)', () => {
    const kb: AgentKnowledgeBase = { products: [{ name: 'Retoque', price: 'Gs 150.000', bookable: false }] };
    expect(isNonBookableProduct(kb, 'Retoque')).toBe(true);
  });

  it('é case-insensitive e ignora espaços nas pontas', () => {
    const kb: AgentKnowledgeBase = { products: [{ name: 'Retoque', price: 'Gs 150.000', bookable: false }] };
    expect(isNonBookableProduct(kb, '  retoque  ')).toBe(true);
  });

  it('false pra produto sem bookable definido (agendável por padrão)', () => {
    const kb: AgentKnowledgeBase = { products: [{ name: 'Microlips', price: 'Gs 500.000' }] };
    expect(isNonBookableProduct(kb, 'Microlips')).toBe(false);
  });

  it('false quando o produto não existe no catálogo', () => {
    const kb: AgentKnowledgeBase = { products: [{ name: 'Microlips', price: 'Gs 500.000' }] };
    expect(isNonBookableProduct(kb, 'Serviço Inexistente')).toBe(false);
  });
});

describe('findProductDurationMinutes', () => {
  it('devolve a duração real cadastrada pro serviço', () => {
    const kb: AgentKnowledgeBase = { products: [{ name: 'Combo Triple: Cejas + Labios + Pestañas', price: 'Gs 1.000.000', durationMinutes: 180 }] };
    expect(findProductDurationMinutes(kb, 'Combo Triple: Cejas + Labios + Pestañas')).toBe(180);
  });

  it('undefined quando o produto não tem duração cadastrada', () => {
    const kb: AgentKnowledgeBase = { products: [{ name: 'Microlips', price: 'Gs 500.000' }] };
    expect(findProductDurationMinutes(kb, 'Microlips')).toBeUndefined();
  });
});
