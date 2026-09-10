/**
 * Operação única da Base de Conhecimento: o cliente edita campos visuais;
 * este módulo os separa nos documentos tipados aceitos pelo backend. Nenhum
 * campo comercial é duplicado no blob legado durante esse fluxo.
 */
import type { AgentFAQ, AgentFileDoc, AgentKnowledgeBase, AgentProduct, FirstContactBlock } from '../types';
import type { KnowledgeBaseDocumentState, KnowledgeBaseDocumentType } from './knowledgeBaseDocuments';

export const VISUAL_KNOWLEDGE_BASE_DOCUMENT_TYPES = [
  'business_profile',
  'brand_voice',
  'service_catalog',
  'pricing_policies',
  'faq',
  'media_assets',
] as const satisfies readonly KnowledgeBaseDocumentType[];

export type VisualKnowledgeBaseDocumentType = (typeof VISUAL_KNOWLEDGE_BASE_DOCUMENT_TYPES)[number];
export type VisualKnowledgeBaseDocumentPayloads = Record<VisualKnowledgeBaseDocumentType, Record<string, unknown>>;

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? value as T[] : [];
}

function documentData(states: KnowledgeBaseDocumentState[], documentType: KnowledgeBaseDocumentType, preferDraft: boolean): Record<string, unknown> {
  const state = states.find((item) => item.documentType === documentType);
  const document = preferDraft ? state?.draft || state?.published : state?.published;
  return document?.data || {};
}

/** Separa a forma usada pelo formulário visual nos seis documentos editáveis. */
export function splitVisualKnowledgeBaseIntoDocuments(knowledgeBase: AgentKnowledgeBase): VisualKnowledgeBaseDocumentPayloads {
  return {
    business_profile: {
      companyName: knowledgeBase.companyName || '',
      agentGoal: knowledgeBase.agentGoal || '',
      businessModel: knowledgeBase.businessModel || '',
      locationMapsUrl: knowledgeBase.locationMapsUrl || '',
      paymentDetailsText: knowledgeBase.paymentDetailsText || '',
    },
    brand_voice: { toneOfVoice: knowledgeBase.toneOfVoice || '' },
    service_catalog: { products: knowledgeBase.products || [] },
    pricing_policies: {
      pricingAndPolicies: knowledgeBase.pricingAndPolicies || '',
      businessRules: knowledgeBase.businessRules || [],
    },
    faq: { faqs: knowledgeBase.faqs || [] },
    media_assets: {
      documents: knowledgeBase.documents || [],
      firstContactBlocks: knowledgeBase.firstContactBlocks || [],
    },
  };
}

/** Reconstrói o formulário visual a partir de versões tipadas, preferindo um rascunho já existente. */
export function composeVisualKnowledgeBaseFromDocuments(states: KnowledgeBaseDocumentState[], preferDraft = true): AgentKnowledgeBase {
  const businessProfile = documentData(states, 'business_profile', preferDraft);
  const brandVoice = documentData(states, 'brand_voice', preferDraft);
  const serviceCatalog = documentData(states, 'service_catalog', preferDraft);
  const pricingPolicies = documentData(states, 'pricing_policies', preferDraft);
  const faq = documentData(states, 'faq', preferDraft);
  const mediaAssets = documentData(states, 'media_assets', preferDraft);

  return {
    companyName: asString(businessProfile.companyName),
    agentGoal: asString(businessProfile.agentGoal),
    businessModel: asString(businessProfile.businessModel),
    locationMapsUrl: asString(businessProfile.locationMapsUrl),
    paymentDetailsText: asString(businessProfile.paymentDetailsText),
    toneOfVoice: asString(brandVoice.toneOfVoice),
    products: asArray<AgentProduct>(serviceCatalog.products),
    pricingAndPolicies: asString(pricingPolicies.pricingAndPolicies),
    businessRules: asArray<string>(pricingPolicies.businessRules),
    faqs: asArray<AgentFAQ>(faq.faqs),
    documents: asArray<AgentFileDoc>(mediaAssets.documents),
    firstContactBlocks: asArray<FirstContactBlock>(mediaAssets.firstContactBlocks),
  };
}

export function documentPayloadsMatch(left: Record<string, unknown>, right: Record<string, unknown>): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}
