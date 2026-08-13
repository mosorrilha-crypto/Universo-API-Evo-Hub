/**
 * Base de conhecimento do agente (objetivo, tom de voz, regras de negócio,
 * catálogo de preços, FAQ) — usada como contexto real nos prompts do Gemini
 * pra resposta automática. Migrado pra tabela Postgres `knowledge_base`
 * (Bloco 2.A), 1 registro (jsonb) por tenant_id.
 */
import { getDb } from './db';

export interface AgentProduct {
  name: string;
  price: string;
  /** Agrupamento pro prompt (ex: "Pestañas", "Cejas") — opcional, catálogos pequenos podem ficar sem. */
  category?: string;
  description?: string;
  /** Foto de exemplo do serviço (data URI base64), pro operador/agente enviar quando o lead perguntar sobre esse serviço específico. */
  exampleImageBase64?: string;
  exampleImageMimeType?: string;
  /** Vídeo de exemplo do produto — arquivo grande demais pra inline base64 (diferente da foto), fica no Storage (bucket "app-data", kb-video/{tenantId}/{exampleVideoId}); aqui só a referência. */
  exampleVideoId?: string;
  exampleVideoFileName?: string;
  exampleVideoMimeType?: string;
  exampleVideoSizeBytes?: number;
  /** Preço promocional com vencimento — volta sozinho pro preço regular após promoUntil, sem precisar editar manualmente. */
  promoPrice?: string;
  promoUntil?: string; // YYYY-MM-DD
  /**
   * Valor numérico do preço regular, opcional — fonte de verdade pra cálculo
   * (Meta CAPI, saldo da seña) sem precisar parsear `price` em texto. Etapa 2
   * do roadmap (achado numa auditoria: `parsePriceToNumber` dependia de
   * regex sobre texto livre tipo "Gs 500.000", frágil se o formato mudar).
   * Produtos legados/genéricos sem isso preenchido continuam funcionando —
   * `resolveProductPriceAmount` cai pro parsing de texto quando ausente.
   */
  priceAmount?: number;
  /** Valor numérico do preço promocional, na mesma moeda de `currency`. */
  promoPriceAmount?: number;
  /** Código da moeda (ex: "PYG", "BRL") — default assumido "PYG" quando ausente, pro tenant legado da Monique. */
  currency?: string;
  /**
   * Duração real da sessão em minutos — fonte de verdade pra calcular o fim
   * do evento no Google Calendar (ver runAgendamentoTools em autoReply.ts).
   * Achado numa auditoria: sem isso, TODO agendamento caía num fallback fixo
   * de 90 minutos pro prompt calcular sozinho, incluindo serviços de 30min
   * (Diseño con Henna) ou 180min (Combo Triple) — bloqueando a agenda real
   * errado.
   */
  durationMinutes?: number;
  /**
   * false = não é um serviço agendável por si só (ex: Retoque — só Monique
   * decide depois de avaliar o resultado, nunca por pedido direto do
   * cliente). Default true (undefined = agendável), pra não quebrar
   * catálogos existentes sem esse campo.
   */
  bookable?: boolean;
}

/** Resolve o preço vigente de um produto — promocional se dentro da validade, regular caso contrário. */
export function resolveProductPrice(product: AgentProduct, timezone = 'America/Asuncion'): string {
  if (!product.promoPrice || !product.promoUntil) return product.price;
  const today = new Date().toLocaleDateString('en-CA', { timeZone: timezone }); // YYYY-MM-DD
  return today <= product.promoUntil ? product.promoPrice : product.price;
}

/**
 * Resolve o valor numérico vigente (promocional se dentro da validade,
 * regular caso contrário) — prefere os campos estruturados (`priceAmount`/
 * `promoPriceAmount`) e só cai pro parsing de texto de `price`/`promoPrice`
 * quando o produto ainda não tem os campos numéricos preenchidos.
 */
export function resolveProductPriceAmount(product: AgentProduct, timezone = 'America/Asuncion'): number {
  if (product.promoPriceAmount != null && product.promoUntil) {
    const today = new Date().toLocaleDateString('en-CA', { timeZone: timezone });
    if (today <= product.promoUntil) return product.promoPriceAmount;
  }
  if (product.priceAmount != null) return product.priceAmount;
  return parsePriceToNumber(resolveProductPrice(product, timezone));
}

/** Converte um preço em texto (ex: "Gs 500.000") pro valor numérico (500000) — usado pra mandar `value` numérico ao Meta CAPI (Epic 4.5.6). Sem dígitos reconhecíveis, devolve 0 (nunca inventa um valor). */
export function parsePriceToNumber(priceText: string | undefined): number {
  if (!priceText) return 0;
  return parseInt(priceText.replace(/\D/g, ''), 10) || 0;
}

/** true quando o nome bate com um produto do catálogo marcado como não-agendável (ex: Retoque) — usado pra recusar `criar_agendamento` nesse serviço e orientar pra avaliação humana em vez de deixar o cliente marcar um turno por conta própria. */
export function isNonBookableProduct(kb: AgentKnowledgeBase | null, productName: string): boolean {
  const normalized = productName.trim().toLowerCase();
  const product = kb?.products?.find((p) => p.name.trim().toLowerCase() === normalized);
  return product?.bookable === false;
}

/** Duração real (minutos) de um produto do catálogo pelo nome exato — usada pra calcular o fim do evento no Google Calendar em vez do fallback fixo de 90min pra qualquer serviço. */
export function findProductDurationMinutes(kb: AgentKnowledgeBase | null, productName: string): number | undefined {
  const normalized = productName.trim().toLowerCase();
  return kb?.products?.find((p) => p.name.trim().toLowerCase() === normalized)?.durationMinutes;
}

export interface AgentFAQ {
  question: string;
  answer: string;
}

export interface AgentKnowledgeBase {
  companyName?: string;
  agentGoal?: string;
  toneOfVoice?: string;
  businessModel?: string;
  pricingAndPolicies?: string;
  products?: AgentProduct[];
  businessRules?: string[];
  faqs?: AgentFAQ[];
}

export async function getKnowledgeBase(tenantId: string): Promise<AgentKnowledgeBase | null> {
  const db = getDb();
  const { data } = await db.from('knowledge_base').select('data').eq('tenant_id', tenantId).maybeSingle();
  return (data?.data as AgentKnowledgeBase | undefined) || null;
}

export async function setKnowledgeBase(tenantId: string, kb: AgentKnowledgeBase): Promise<void> {
  const db = getDb();
  const { error } = await db
    .from('knowledge_base')
    .upsert({ tenant_id: tenantId, data: kb, updated_at: new Date().toISOString() }, { onConflict: 'tenant_id' });
  if (error) throw error;
}

/** Formata a base de conhecimento como texto pra injetar direto no prompt do Gemini. */
export function formatKnowledgeBaseForPrompt(kb: AgentKnowledgeBase | null): string {
  if (!kb) return '';

  const parts: string[] = [];
  if (kb.companyName) parts.push(`Empresa: ${kb.companyName}`);
  if (kb.agentGoal) parts.push(`Objetivo do atendimento: ${kb.agentGoal}`);
  if (kb.toneOfVoice) parts.push(`Tom de voz: ${kb.toneOfVoice}`);
  // Achado numa auditoria pós-lançamento: este campo (endereço, horário de
  // funcionamento em texto, Instagram) nunca era lido aqui — o único lugar
  // que guardava esse dado nunca chegava no prompt do Gemini. Perguntas
  // reais de cliente tipo "a que horas vocês abrem?"/"onde fica?" ficavam
  // sem resposta (o agente segue a regra de nunca inventar, então o efeito
  // era uma resposta genérica de "vou confirmar", não uma alucinação — mas
  // ainda assim quebrava uma das perguntas mais comuns de FAQ).
  if (kb.businessModel) parts.push(`Sobre o negócio (endereço, horário, posicionamento): ${kb.businessModel}`);
  if (kb.pricingAndPolicies) parts.push(`Políticas de preço/pagamento: ${kb.pricingAndPolicies}`);
  if (kb.businessRules?.length) parts.push(`Regras de negócio:\n- ${kb.businessRules.join('\n- ')}`);
  if (kb.products?.length) {
    const line = (p: AgentProduct) => `- ${p.name}: ${resolveProductPrice(p)}${p.description ? ` — ${p.description}` : ''}`;
    const categories = [...new Set(kb.products.map((p) => p.category).filter((c): c is string => !!c))];
    if (categories.length) {
      const uncategorized = kb.products.filter((p) => !p.category);
      const grouped = categories
        .map((cat) => `${cat}:\n${kb.products!.filter((p) => p.category === cat).map(line).join('\n')}`)
        .concat(uncategorized.length ? [`Outros:\n${uncategorized.map(line).join('\n')}`] : []);
      parts.push(`Catálogo de produtos/serviços:\n${grouped.join('\n\n')}`);
    } else {
      parts.push(`Catálogo de produtos/serviços:\n${kb.products.map(line).join('\n')}`);
    }
  }
  if (kb.faqs?.length) {
    parts.push(`Perguntas frequentes:\n${kb.faqs.map((f) => `P: ${f.question}\nR: ${f.answer}`).join('\n')}`);
  }

  if (!parts.length) return '';
  return `\nContexto real do negócio (use essas informações pra responder com precisão, nunca invente preços/regras fora daqui):\n${parts.join('\n\n')}\n`;
}
