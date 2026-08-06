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
  /** Preço promocional com vencimento — volta sozinho pro preço regular após promoUntil, sem precisar editar manualmente. */
  promoPrice?: string;
  promoUntil?: string; // YYYY-MM-DD
}

/** Resolve o preço vigente de um produto — promocional se dentro da validade, regular caso contrário. */
export function resolveProductPrice(product: AgentProduct, timezone = 'America/Asuncion'): string {
  if (!product.promoPrice || !product.promoUntil) return product.price;
  const today = new Date().toLocaleDateString('en-CA', { timeZone: timezone }); // YYYY-MM-DD
  return today <= product.promoUntil ? product.promoPrice : product.price;
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
