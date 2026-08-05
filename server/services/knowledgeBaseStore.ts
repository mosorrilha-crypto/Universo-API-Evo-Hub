/**
 * Base de conhecimento do agente (objetivo, tom de voz, regras de negócio,
 * catálogo de preços, FAQ) — usada como contexto real nos prompts do Gemini
 * pra resposta automática (server/services/autoReply.ts e
 * geminiTranscription.ts), em vez de respostas genéricas. Persiste no mesmo
 * Supabase Storage usado por conversas/status do agente.
 */

export interface AgentProduct {
  name: string;
  price: string;
  description?: string;
  /** Foto de exemplo do serviço (data URI base64), pro operador/agente enviar quando o lead perguntar sobre esse serviço específico. */
  exampleImageBase64?: string;
  exampleImageMimeType?: string;
  /** Preço promocional com vencimento — volta sozinho pro preço regular após promoUntil, sem precisar editar manualmente. */
  promoPrice?: string;
  promoUntil?: string; // YYYY-MM-DD
}

/** Resolve o preço vigente de um produto — promocional se dentro da validade, regular caso contrário. Mesma lógica do resolverPreco() do whatsapp-agent-monique. */
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

const BUCKET = 'app-data';
const OBJECT_PATH = 'knowledge-base.json';

let knowledgeBase: AgentKnowledgeBase | null = null;
let persistence: { supabaseUrl: string; supabaseKey: string } | null = null;

export async function initKnowledgeBasePersistence(supabaseUrl?: string, supabaseKey?: string) {
  if (!supabaseUrl || !supabaseKey) return;
  persistence = { supabaseUrl, supabaseKey };

  try {
    const res = await fetch(`${supabaseUrl}/storage/v1/object/${BUCKET}/${OBJECT_PATH}`, {
      headers: { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}` },
    });
    if (res.ok) {
      knowledgeBase = (await res.json()) as AgentKnowledgeBase;
      console.log('💾 [Base de Conhecimento] Restaurada do Supabase Storage.');
    }
  } catch (err) {
    console.warn('⚠️  [Base de Conhecimento] Falha ao carregar:', (err as Error).message);
  }
}

export function getKnowledgeBase(): AgentKnowledgeBase | null {
  return knowledgeBase;
}

export async function setKnowledgeBase(kb: AgentKnowledgeBase) {
  knowledgeBase = kb;
  if (!persistence) return;
  try {
    await fetch(`${persistence.supabaseUrl}/storage/v1/object/${BUCKET}/${OBJECT_PATH}`, {
      method: 'POST',
      headers: {
        apikey: persistence.supabaseKey,
        Authorization: `Bearer ${persistence.supabaseKey}`,
        'Content-Type': 'application/json',
        'x-upsert': 'true',
      },
      body: JSON.stringify(kb),
    });
  } catch (err) {
    console.warn('⚠️  [Base de Conhecimento] Falha ao salvar:', (err as Error).message);
  }
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
    parts.push(`Catálogo de produtos/serviços:\n${kb.products.map((p) => `- ${p.name}: ${resolveProductPrice(p)}${p.description ? ` (${p.description})` : ''}`).join('\n')}`);
  }
  if (kb.faqs?.length) {
    parts.push(`Perguntas frequentes:\n${kb.faqs.map((f) => `P: ${f.question}\nR: ${f.answer}`).join('\n')}`);
  }

  if (!parts.length) return '';
  return `\nContexto real do negócio (use essas informações pra responder com precisão, nunca invente preços/regras fora daqui):\n${parts.join('\n\n')}\n`;
}
