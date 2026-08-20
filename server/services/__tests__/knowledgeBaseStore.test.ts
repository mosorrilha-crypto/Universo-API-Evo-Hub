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
  resolveProductAmountByName,
  isNonBookableProduct,
  findProductDurationMinutes,
  findProductMatch,
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

  it('inclui locationMapsUrl no texto do prompt, instruindo o agente a mandar o link', () => {
    const kb: AgentKnowledgeBase = {
      companyName: 'Estúdio Teste',
      locationMapsUrl: 'https://www.google.com/maps/search/?api=1&query=Rua+X+123',
    };
    const text = formatKnowledgeBaseForPrompt(kb);
    expect(text).toContain('https://www.google.com/maps/search/?api=1&query=Rua+X+123');
  });

  it('não quebra quando locationMapsUrl está ausente (não inventa link)', () => {
    const kb: AgentKnowledgeBase = { companyName: 'Estúdio Teste' };
    const text = formatKnowledgeBaseForPrompt(kb);
    expect(text).not.toContain('maps');
  });

  it('lista as variantes (tamanho + preço) de um produto unificado, pro agente cotar pelo tamanho certo', () => {
    const kb: AgentKnowledgeBase = {
      companyName: 'Clic Piscinas',
      products: [
        {
          name: 'Piscina Fibratec Acapulco',
          price: 'Sob consulta (varia por tamanho, ver descrição)',
          description: 'Familia Acapulco.',
          variants: [
            { code: 'AC F400', dimensions: '4,10x2,30m', litros: 7800, price: 'Gs 12.000.000' },
            { code: 'AC F500', dimensions: '5,20x2,70m', litros: 13600, price: 'Gs 15.000.000' },
          ],
        },
      ],
    };
    const text = formatKnowledgeBaseForPrompt(kb);
    expect(text).toContain('AC F400');
    expect(text).toContain('Gs 12.000.000');
    expect(text).toContain('AC F500');
    expect(text).toContain('Gs 15.000.000');
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

/**
 * Pedido real (20/08/2026): agrupar os serviços de uma família (ex:
 * "Pestañas" cobrindo "Lash Lift", "Efecto Delineado" etc., cada um com
 * duração/preço/bookable próprios) sem findProductMatch soube procurar
 * dentro de `variants` quebraria silenciosamente duração de agendamento,
 * valor do registro financeiro e envio de foto/vídeo de exemplo assim que
 * um serviço deixasse de ser um produto de topo.
 */
describe('findProductMatch (produto de topo ou variante dentro de uma família)', () => {
  const familyKb: AgentKnowledgeBase = {
    products: [
      {
        name: 'Pestañas',
        price: 'Sob consulta',
        exampleImageBase64: 'ZmFrZS1mb3RvLWZhbWlsaWE=',
        variants: [
          { code: 'Lash Lift', price: 'Gs 140.000', priceAmount: 140000, durationMinutes: 90 },
          { code: 'Efecto Delineado', price: 'Gs 220.000', priceAmount: 220000, durationMinutes: 120, bookable: false },
        ],
      },
    ],
  };

  it('acha o produto direto pelo nome quando não tem variantes envolvidas', () => {
    const kb: AgentKnowledgeBase = { products: [{ name: 'Microlips', price: 'Gs 500.000' }] };
    const match = findProductMatch(kb, 'Microlips');
    expect(match?.product.name).toBe('Microlips');
    expect(match?.variant).toBeUndefined();
  });

  it('acha o produto PAI e a variante batida quando o nome bate com uma variante dentro de uma família', () => {
    const match = findProductMatch(familyKb, 'Lash Lift');
    expect(match?.product.name).toBe('Pestañas');
    expect(match?.variant?.code).toBe('Lash Lift');
  });

  it('undefined quando o nome não bate nem com produto nem com variante nenhuma', () => {
    expect(findProductMatch(familyKb, 'Serviço Inexistente')).toBeUndefined();
  });

  it('findProductDurationMinutes usa a duração da variante, não a do produto pai (que nem tem)', () => {
    expect(findProductDurationMinutes(familyKb, 'Lash Lift')).toBe(90);
    expect(findProductDurationMinutes(familyKb, 'Efecto Delineado')).toBe(120);
  });

  it('findProductDurationMinutes cai pra duração do produto pai quando a variante não tem duração própria', () => {
    const kb: AgentKnowledgeBase = {
      products: [{
        name: 'Cejas',
        price: 'Sob consulta',
        durationMinutes: 90,
        variants: [{ code: 'Diseño con Henna', price: 'Gs 80.000' }],
      }],
    };
    expect(findProductDurationMinutes(kb, 'Diseño con Henna')).toBe(90);
  });

  it('isNonBookableProduct usa o bookable da variante, não o do produto pai', () => {
    expect(isNonBookableProduct(familyKb, 'Efecto Delineado')).toBe(true);
    expect(isNonBookableProduct(familyKb, 'Lash Lift')).toBe(false);
  });

  it('resolveProductAmountByName usa o preço da variante batida, não o do produto pai (que não tem preço numérico)', () => {
    expect(resolveProductAmountByName(familyKb, 'Lash Lift')).toBe(140000);
    expect(resolveProductAmountByName(familyKb, 'Efecto Delineado')).toBe(220000);
  });

  it('resolveProductAmountByName cai pro resolveProductPriceAmount do produto pai quando o nome bate direto nele', () => {
    const kb: AgentKnowledgeBase = { products: [{ name: 'Microlips', price: 'Gs 500.000', priceAmount: 500000 }] };
    expect(resolveProductAmountByName(kb, 'Microlips')).toBe(500000);
  });

  it('resolveProductAmountByName undefined quando o nome não bate com nada (nunca inventa valor)', () => {
    expect(resolveProductAmountByName(familyKb, 'Serviço Inexistente')).toBeUndefined();
  });
});
