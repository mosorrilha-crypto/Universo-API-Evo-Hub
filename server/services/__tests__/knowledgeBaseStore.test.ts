/**
 * Achado numa auditoria pós-lançamento: formatKnowledgeBaseForPrompt nunca
 * lia kb.businessModel — endereço, horário em texto e Instagram nunca
 * chegavam no prompt do Gemini, quebrando perguntas de FAQ reais tipo
 * "a que horas abrem?"/"onde fica?".
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  composeKnowledgeBaseDocuments,
  getPublishedKnowledgeBaseDocuments,
  formatKnowledgeBaseForPrompt,
  resolveProductPriceAmount,
  resolveProductAmountByName,
  isNonBookableProduct,
  findProductDurationMinutes,
  findProductMatch,
  collectReferencedVideoIds,
  type AgentKnowledgeBase,
  type AgentProduct,
  type KnowledgeBaseDocument,
} from '../knowledgeBaseStore';
import { initDb } from '../db';
import { createFakeSupabase } from './fakeSupabase';

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

  it('lista preço e descrição próprios de cada variação, pro agente diferenciar opções da mesma família', () => {
    const kb: AgentKnowledgeBase = {
      companyName: 'Clic Piscinas',
      products: [
        {
          name: 'Piscina Fibratec Acapulco',
          price: 'Sob consulta (varia por tamanho, ver descrição)',
          description: 'Familia Acapulco.',
          variants: [
            { code: 'AC F400', description: 'Modelo compacto para quintais menores.', dimensions: '4,10x2,30m', litros: 7800, price: 'Gs 12.000.000' },
            { code: 'AC F500', dimensions: '5,20x2,70m', litros: 13600, price: 'Gs 15.000.000' },
          ],
        },
      ],
    };
    const text = formatKnowledgeBaseForPrompt(kb);
    expect(text).toContain('AC F400');
    expect(text).toContain('Gs 12.000.000');
    expect(text).toContain('Modelo compacto para quintais menores.');
    expect(text).toContain('AC F500');
    expect(text).toContain('Gs 15.000.000');
  });
});

describe('collectReferencedVideoIds', () => {
  it('mantém o vídeo usado por uma variação para que o salvamento não o trate como órfão', () => {
    const ids = collectReferencedVideoIds({
      products: [{
        name: 'Pestañas',
        price: 'Consultar',
        variants: [{ code: 'Efecto Foxy', price: 'Gs 200.000', exampleVideoId: 'video-foxy' }],
      }],
    });

    expect(ids).toEqual(new Set(['video-foxy']));
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

  it('produto com variantes e sem priceAmount próprio: nunca parseia o texto de faixa do cabeçalho (achado real 26/08/2026, ex: "Gs 140.000 a Gs 350.000" virando 140000350000)', () => {
    const product: AgentProduct = {
      name: 'Pestañas',
      price: 'Gs 140.000 a Gs 350.000 (varia por efeito)',
      variants: [{ code: 'Lash Lift', price: 'Gs 140.000', priceAmount: 140000 }],
    };
    expect(resolveProductPriceAmount(product)).toBe(0);
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

  it('true quando o produto está marcado active:false, mesmo sem bookable:false', () => {
    const kb: AgentKnowledgeBase = { products: [{ name: 'Efecto Foxy', price: 'Gs 200.000', active: false }] };
    expect(isNonBookableProduct(kb, 'Efecto Foxy')).toBe(true);
  });
});

describe('formatKnowledgeBaseForPrompt — status/visibilidade (active)', () => {
  it('omite produto marcado active:false do catálogo do prompt', () => {
    const kb: AgentKnowledgeBase = {
      companyName: 'Estúdio Teste',
      products: [
        { name: 'Microlips', price: 'Gs 500.000', active: false },
        { name: 'Lash Lift', price: 'Gs 140.000' },
      ],
    };
    const text = formatKnowledgeBaseForPrompt(kb);
    expect(text).not.toContain('Microlips');
    expect(text).toContain('Lash Lift');
  });

  it('inclui produto sem active definido (ativo por padrão)', () => {
    const kb: AgentKnowledgeBase = { products: [{ name: 'Microlips', price: 'Gs 500.000' }] };
    expect(formatKnowledgeBaseForPrompt(kb)).toContain('Microlips');
  });

  it('omite produto inativo também dentro de uma categoria agrupada', () => {
    const kb: AgentKnowledgeBase = {
      products: [
        { name: 'Microlips', price: 'Gs 500.000', category: 'Labios', active: false },
        { name: 'Neutralización', price: 'Gs 450.000', category: 'Labios' },
      ],
    };
    const text = formatKnowledgeBaseForPrompt(kb);
    expect(text).not.toContain('Microlips');
    expect(text).toContain('Neutralización');
  });

  it('não lista o catálogo quando todos os produtos estão inativos', () => {
    const kb: AgentKnowledgeBase = { products: [{ name: 'Microlips', price: 'Gs 500.000', active: false }] };
    expect(formatKnowledgeBaseForPrompt(kb)).not.toContain('Catálogo de produtos/serviços');
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

/**
 * ISSUE-0096 / PR1 — equivalência da forma publicada com o blob legado. As
 * fixtures representam as famílias que mais exigem preservação no corte:
 * Monique (duração/agendabilidade/mídia) e Clic Piscinas (variantes/preços).
 * Nenhuma contém imagens/base64 reais, pois a regra sob teste é estrutural.
 */
describe('composeKnowledgeBaseDocuments — equivalência da KB tipada', () => {
  const moniqueAndClicLegacy: AgentKnowledgeBase = {
    companyName: 'Monique Beauty & Clic Piscinas',
    agentGoal: 'Responder somente com informações cadastradas.',
    businessModel: 'Atendimento com horário marcado e catálogo por modelo.',
    locationMapsUrl: 'https://maps.example.test/monique-clic',
    toneOfVoice: 'Acolhedor, direto e profissional.',
    pricingAndPolicies: 'Preços podem variar por modelo e campanha vigente.',
    businessRules: ['Nunca inventar preço.', 'Retoque exige avaliação humana.'],
    products: [
      {
        name: 'Pestañas',
        price: 'Consultar por efeito',
        variants: [{ code: 'Lash Lift', price: 'Gs 140.000', priceAmount: 140000, durationMinutes: 90, exampleVideoId: 'video-lash-lift' }],
      },
      {
        name: 'Piscina Fibratec Acapulco',
        price: 'Consultar por tamanho',
        variants: [{ code: 'AC F400', dimensions: '4,10x2,30m', litros: 7800, price: 'Gs 12.000.000', priceAmount: 12000000 }],
      },
    ],
    faqs: [{ question: 'Como agendar?', answer: 'Envie a opção desejada para confirmar disponibilidade.' }],
    documents: [{ id: 'catalogo-pdf', fileName: 'catalogo.pdf', fileSize: '10 KB', uploadDate: '2026-08-26', status: 'Processado', extractedText: 'Modelos disponíveis.' }],
    firstContactBlocks: [{ id: 'boas-vindas', type: 'video', videoId: 'welcome-video', videoCaption: 'Conheça as opções.' }],
  };

  const publishedDocuments: KnowledgeBaseDocument[] = [
    { id: '1', tenantId: 'tenant-a', documentType: 'business_profile', version: 1, status: 'published', data: { companyName: moniqueAndClicLegacy.companyName, agentGoal: moniqueAndClicLegacy.agentGoal, businessModel: moniqueAndClicLegacy.businessModel, locationMapsUrl: moniqueAndClicLegacy.locationMapsUrl } },
    { id: '2', tenantId: 'tenant-a', documentType: 'brand_voice', version: 1, status: 'published', data: { toneOfVoice: moniqueAndClicLegacy.toneOfVoice } },
    { id: '3', tenantId: 'tenant-a', documentType: 'service_catalog', version: 1, status: 'published', data: { products: moniqueAndClicLegacy.products } },
    { id: '4', tenantId: 'tenant-a', documentType: 'pricing_policies', version: 1, status: 'published', data: { pricingAndPolicies: moniqueAndClicLegacy.pricingAndPolicies, businessRules: moniqueAndClicLegacy.businessRules } },
    { id: '5', tenantId: 'tenant-a', documentType: 'opening_hours', version: 1, status: 'published', data: {} },
    { id: '6', tenantId: 'tenant-a', documentType: 'faq', version: 1, status: 'published', data: { faqs: moniqueAndClicLegacy.faqs } },
    { id: '7', tenantId: 'tenant-a', documentType: 'human_handoff_rules', version: 1, status: 'published', data: {} },
    { id: '8', tenantId: 'tenant-a', documentType: 'media_assets', version: 1, status: 'published', data: { documents: moniqueAndClicLegacy.documents, firstContactBlocks: moniqueAndClicLegacy.firstContactBlocks } },
  ];

  it('recompõe todos os campos mapeados sem perder variantes, preços, duração ou mídia', () => {
    const composed = composeKnowledgeBaseDocuments(publishedDocuments);

    expect(composed).toEqual(moniqueAndClicLegacy);
    expect(formatKnowledgeBaseForPrompt(composed)).toBe(formatKnowledgeBaseForPrompt(moniqueAndClicLegacy));
    expect(resolveProductAmountByName(composed, 'Lash Lift')).toBe(140000);
    expect(resolveProductAmountByName(composed, 'AC F400')).toBe(12000000);
    expect(findProductDurationMinutes(composed, 'Lash Lift')).toBe(90);
    expect(collectReferencedVideoIds(composed)).toEqual(new Set(['video-lash-lift', 'welcome-video']));
  });

  it('ignora rascunho e campos fora do contrato do tipo documental', () => {
    const composed = composeKnowledgeBaseDocuments([
      ...publishedDocuments,
      { id: 'draft', tenantId: 'tenant-a', documentType: 'brand_voice', version: 2, status: 'draft', data: { toneOfVoice: 'Nunca deve vazar ao runtime.' } },
      { id: 'extra', tenantId: 'tenant-a', documentType: 'faq', version: 1, status: 'published', data: { faqs: moniqueAndClicLegacy.faqs, products: [] } },
    ]);

    expect(composed.toneOfVoice).toBe(moniqueAndClicLegacy.toneOfVoice);
    expect(composed.products).toEqual(moniqueAndClicLegacy.products);
  });
});

describe('getPublishedKnowledgeBaseDocuments', () => {
  beforeEach(() => {
    initDb(createFakeSupabase({
      knowledge_base_documents: [
        { id: 'published-a', tenant_id: 'tenant-a', document_type: 'faq', version: 1, status: 'published', data: { faqs: [] } },
        { id: 'draft-a', tenant_id: 'tenant-a', document_type: 'faq', version: 2, status: 'draft', data: { faqs: [{ question: 'interno', answer: 'não publicar' }] } },
        { id: 'published-b', tenant_id: 'tenant-b', document_type: 'faq', version: 1, status: 'published', data: { faqs: [] } },
      ],
    }) as any);
  });

  afterEach(() => initDb(null));

  it('lê apenas a publicação do tenant solicitado', async () => {
    await expect(getPublishedKnowledgeBaseDocuments('tenant-a')).resolves.toEqual([
      expect.objectContaining({ id: 'published-a', tenantId: 'tenant-a', documentType: 'faq', version: 1, status: 'published' }),
    ]);
  });
});
