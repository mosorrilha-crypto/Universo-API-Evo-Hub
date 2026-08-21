import type { AgentKnowledgeBase, AgentProduct, BusinessHours, ProductVariant } from '../types';

export type AuditSeverity = 'critical' | 'attention' | 'info';
export type AuditArea = 'context' | 'catalog' | 'operation' | 'documents';

export interface KnowledgeAuditFinding {
  id: string;
  area: AuditArea;
  severity: AuditSeverity;
  title: string;
  description: string;
}

export interface KnowledgeAudit {
  findings: KnowledgeAuditFinding[];
  totals: Record<AuditSeverity, number>;
  activeProducts: number;
  categorizedProducts: number;
  actionableProductIds: Set<string>;
}

function hasText(value: string | undefined) {
  return Boolean(value?.trim());
}

function hasNumericPrice(value: string | undefined) {
  return Boolean(value?.replace(/\D/g, ''));
}

function isUnspecifiedPrice(value: string | undefined) {
  return !hasText(value) || /sob\s+consulta/i.test(value || '');
}

function normalized(value: string | undefined) {
  return (value || '').trim().toLocaleLowerCase('pt-BR');
}

function variantNeedsAttention(variant: ProductVariant, parent: AgentProduct) {
  if (!hasText(variant.code) || isUnspecifiedPrice(variant.price)) return true;
  if (hasNumericPrice(variant.price) && variant.priceAmount == null) return true;
  const isBookable = variant.bookable ?? parent.bookable ?? true;
  return isBookable && !(variant.durationMinutes ?? parent.durationMinutes);
}

export function productNeedsAttention(product: AgentProduct, now = new Date()) {
  if (product.active === false) return false;
  if (!hasText(product.category) || !hasText(product.description) || product.description === 'Sem descrição cadastrada') return true;
  if (isUnspecifiedPrice(product.price)) return true;
  if (hasNumericPrice(product.price) && product.priceAmount == null) return true;
  if (product.bookable !== false && !product.durationMinutes) return true;
  if (product.variants?.some((variant) => variantNeedsAttention(variant, product))) return true;
  return Boolean(product.promoUntil && new Date(`${product.promoUntil}T23:59:59`).getTime() < now.getTime());
}

/**
 * Avalia se as informações persistidas dão suporte a uma resposta e a um
 * agendamento precisos. Não muda a KB nem presume valores ausentes.
 */
export function auditKnowledgeBase(kb: AgentKnowledgeBase, businessHours: BusinessHours, now = new Date()): KnowledgeAudit {
  const findings: KnowledgeAuditFinding[] = [];
  const add = (finding: KnowledgeAuditFinding) => findings.push(finding);
  const contextFields: Array<[keyof AgentKnowledgeBase, string]> = [
    ['companyName', 'Nome da empresa'],
    ['agentGoal', 'Objetivo do agente'],
    ['toneOfVoice', 'Tom de voz'],
    ['businessModel', 'Informações do negócio'],
    ['pricingAndPolicies', 'Políticas comerciais'],
  ];
  for (const [field, label] of contextFields) {
    if (!hasText(kb[field] as string | undefined)) {
      add({ id: `context-${field}`, area: 'context', severity: 'attention', title: `${label} não informado`, description: 'O agente pode precisar encaminhar dúvidas básicas por falta desse contexto.' });
    }
  }
  if (!hasText(kb.locationMapsUrl)) {
    add({ id: 'context-location', area: 'context', severity: 'info', title: 'Localização sem link navegável', description: 'Cadastre um link do Google Maps para responder pedidos de endereço com precisão.' });
  }
  if (!Object.keys(businessHours).length) {
    add({ id: 'operation-hours', area: 'operation', severity: 'attention', title: 'Horários de atendimento não cadastrados', description: 'Sem horários, a agenda e as respostas sobre funcionamento ficam incompletas.' });
  }

  const activeProducts = kb.products.filter((product) => product.active !== false);
  const actionableProductIds = new Set(activeProducts.filter((product) => productNeedsAttention(product, now)).map((product) => product.id));
  const categorizedProducts = activeProducts.filter((product) => hasText(product.category)).length;
  if (!activeProducts.length) {
    add({ id: 'catalog-empty', area: 'catalog', severity: 'critical', title: 'Catálogo ativo vazio', description: 'O agente não possui produtos ou serviços ativos para cotar e recomendar.' });
  }
  for (const product of activeProducts) {
    const prefix = `catalog-${product.id}`;
    if (!hasText(product.category)) add({ id: `${prefix}-category`, area: 'catalog', severity: 'info', title: `${product.name}: sem categoria`, description: 'Categorize o item para manter o catálogo organizado e o contexto do agente mais claro.' });
    if (!hasText(product.description) || product.description === 'Sem descrição cadastrada') add({ id: `${prefix}-description`, area: 'catalog', severity: 'attention', title: `${product.name}: descrição insuficiente`, description: 'Inclua uma explicação objetiva para o agente diferenciar o serviço corretamente.' });
    if (isUnspecifiedPrice(product.price)) add({ id: `${prefix}-price`, area: 'catalog', severity: 'attention', title: `${product.name}: preço sob consulta`, description: 'O agente não deve inventar valores; defina o preço ou uma regra explícita de encaminhamento.' });
    if (hasNumericPrice(product.price) && product.priceAmount == null) add({ id: `${prefix}-amount`, area: 'catalog', severity: 'attention', title: `${product.name}: valor numérico ausente`, description: 'Preencha o valor estruturado para que agenda e financeiro usem o mesmo montante.' });
    if (product.bookable !== false && !product.durationMinutes) add({ id: `${prefix}-duration`, area: 'operation', severity: 'attention', title: `${product.name}: duração ausente`, description: 'Serviços agendáveis precisam de duração para não bloquear horários incorretos no calendário.' });
    if (product.promoUntil && new Date(`${product.promoUntil}T23:59:59`).getTime() < now.getTime()) add({ id: `${prefix}-promotion`, area: 'catalog', severity: 'info', title: `${product.name}: promoção expirada`, description: 'A regra já voltou ao preço regular; remova ou renove a promoção para manter o catálogo limpo.' });
    product.variants?.forEach((variant, index) => {
      if (!hasText(variant.code) || isUnspecifiedPrice(variant.price)) add({ id: `${prefix}-variant-${index}`, area: 'catalog', severity: 'attention', title: `${product.name}: variante incompleta`, description: 'Toda variante precisa de nome e preço ou regra de encaminhamento claros.' });
      if (hasNumericPrice(variant.price) && variant.priceAmount == null) add({ id: `${prefix}-variant-amount-${index}`, area: 'catalog', severity: 'attention', title: `${product.name}: valor estruturado da variante ausente`, description: 'Preencha o valor numérico para evitar divergência no financeiro.' });
    });
  }

  const names = new Map<string, string>();
  for (const product of activeProducts) {
    for (const name of [product.name, ...(product.aliases || [])]) {
      const key = normalized(name);
      if (!key) continue;
      const existing = names.get(key);
      if (existing && existing !== product.id) add({ id: `catalog-duplicate-${key}`, area: 'catalog', severity: 'attention', title: `Nome ou apelido duplicado: ${name}`, description: 'A duplicidade pode fazer o agente associar o pedido do cliente ao produto errado.' });
      else names.set(key, product.id);
    }
  }

  if (!kb.faqs.length) add({ id: 'context-faq-empty', area: 'context', severity: 'info', title: 'Sem perguntas frequentes cadastradas', description: 'Cadastre dúvidas recorrentes para reduzir respostas genéricas e escalonamentos.' });
  const pendingDocuments = kb.documents.filter((document) => document.status === 'Pendente');
  if (pendingDocuments.length) add({ id: 'documents-pending', area: 'documents', severity: 'attention', title: `${pendingDocuments.length} documento(s) pendente(s)`, description: 'O conteúdo desses anexos ainda não está disponível como referência para o agente.' });
  const documentsWithoutText = kb.documents.filter((document) => document.status === 'Processado' && !hasText(document.extractedText));
  if (documentsWithoutText.length) add({ id: 'documents-no-text', area: 'documents', severity: 'info', title: `${documentsWithoutText.length} documento(s) sem texto extraído`, description: 'O arquivo está armazenado, mas pode não ser lido pela IA; revise o formato ou inclua um resumo na base.' });

  const totals: Record<AuditSeverity, number> = { critical: 0, attention: 0, info: 0 };
  findings.forEach((finding) => { totals[finding.severity] += 1; });
  return { findings, totals, activeProducts: activeProducts.length, categorizedProducts, actionableProductIds };
}
