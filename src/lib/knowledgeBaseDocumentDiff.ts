/**
 * Achado real (26/08/2026, pedido do dono do produto): o painel mostra
 * "Rascunho pendente" em cada card, mas o formulário sempre exibe SÓ uma
 * versão (o rascunho, se existir, senão o publicado — ver
 * composeVisualKnowledgeBaseFromDocuments) — nunca as duas lado a lado. Não
 * dava pra saber o que de fato mudaria ao publicar sem lembrar de cabeça.
 * Este módulo compara o `data` publicado com o `data` do rascunho de um
 * documento tipado e devolve uma lista plana de campos/itens diferentes,
 * pronta pra renderizar como tabela "Publicado | Rascunho".
 */
import type { KnowledgeBaseDocumentType } from './knowledgeBaseDocuments';
import type { AgentFAQ, AgentProduct } from '../types';

export interface KnowledgeBaseDocumentDiffEntry {
  label: string;
  before: string;
  after: string;
}

const EMPTY = '(vazio)';
const NOT_PRESENT_BEFORE = '(novo)';
const NOT_PRESENT_AFTER = '(removido)';

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function textOrEmpty(value: string): string {
  return value.trim() ? value : EMPTY;
}

function diffTextField(label: string, before: unknown, after: unknown): KnowledgeBaseDocumentDiffEntry[] {
  const beforeText = asString(before);
  const afterText = asString(after);
  if (beforeText === afterText) return [];
  return [{ label, before: textOrEmpty(beforeText), after: textOrEmpty(afterText) }];
}

/** Regras de negócio e outras listas simples de string — diffadas por presença, não por posição (reordenar não deveria contar como mudança). */
function diffStringList(label: string, before: unknown, after: unknown): KnowledgeBaseDocumentDiffEntry[] {
  const beforeList = asArray<string>(before);
  const afterList = asArray<string>(after);
  const beforeSet = new Set(beforeList);
  const afterSet = new Set(afterList);
  const entries: KnowledgeBaseDocumentDiffEntry[] = [];
  afterList.forEach((item) => {
    if (!beforeSet.has(item)) entries.push({ label: `${label} — nova`, before: NOT_PRESENT_BEFORE, after: item });
  });
  beforeList.forEach((item) => {
    if (!afterSet.has(item)) entries.push({ label: `${label} — removida`, before: item, after: NOT_PRESENT_AFTER });
  });
  return entries;
}

function money(value: unknown): string {
  return typeof value === 'number' ? value.toLocaleString('pt-BR') : '';
}

function describeProduct(product: AgentProduct): string {
  const parts = [product.name || '(sem nome)', product.price || 'Sob Consulta'];
  if (product.bookable === false) parts.push('não agendável');
  if (product.active === false) parts.push('inativo');
  return parts.join(' — ');
}

/** Diff item a item por `id` — cobre produto novo/removido/alterado, sem exigir reordenar a lista inteira pra contar como igual. */
function diffProducts(before: unknown, after: unknown): KnowledgeBaseDocumentDiffEntry[] {
  const beforeList = asArray<AgentProduct>(before);
  const afterList = asArray<AgentProduct>(after);
  const beforeById = new Map(beforeList.map((item) => [item.id, item]));
  const afterById = new Map(afterList.map((item) => [item.id, item]));
  const entries: KnowledgeBaseDocumentDiffEntry[] = [];

  afterById.forEach((product, id) => {
    const previous = beforeById.get(id);
    if (!previous) {
      entries.push({ label: `Serviço novo — ${product.name || '(sem nome)'}`, before: NOT_PRESENT_BEFORE, after: describeProduct(product) });
      return;
    }
    const fieldChecks: [string, unknown, unknown, ((v: unknown) => string)?][] = [
      ['nome', previous.name, product.name],
      ['preço', previous.price, product.price],
      ['valor', previous.priceAmount, product.priceAmount, money],
      ['descrição', previous.description, product.description],
      ['categoria', previous.category, product.category],
      ['duração (min)', previous.durationMinutes, product.durationMinutes],
      ['agendável', previous.bookable, product.bookable],
      ['ativo', previous.active, product.active],
    ];
    fieldChecks.forEach(([fieldLabel, beforeValue, afterValue, format]) => {
      if (JSON.stringify(beforeValue ?? null) === JSON.stringify(afterValue ?? null)) return;
      const fmt = format || ((v: unknown) => (v === undefined || v === null || v === '' ? EMPTY : String(v)));
      entries.push({ label: `${product.name || '(sem nome)'} — ${fieldLabel}`, before: fmt(beforeValue), after: fmt(afterValue) });
    });
    if (JSON.stringify(previous.variants ?? null) !== JSON.stringify(product.variants ?? null)) {
      entries.push({ label: `${product.name || '(sem nome)'} — variações`, before: '(alterado)', after: '(alterado, ver formulário)' });
    }
  });
  beforeById.forEach((product, id) => {
    if (!afterById.has(id)) entries.push({ label: `Serviço removido — ${product.name || '(sem nome)'}`, before: describeProduct(product), after: NOT_PRESENT_AFTER });
  });
  return entries;
}

function diffFaqs(before: unknown, after: unknown): KnowledgeBaseDocumentDiffEntry[] {
  const beforeList = asArray<AgentFAQ>(before);
  const afterList = asArray<AgentFAQ>(after);
  const beforeById = new Map(beforeList.map((item) => [item.id, item]));
  const afterById = new Map(afterList.map((item) => [item.id, item]));
  const entries: KnowledgeBaseDocumentDiffEntry[] = [];

  afterById.forEach((faq, id) => {
    const previous = beforeById.get(id);
    if (!previous) {
      entries.push({ label: 'Pergunta nova', before: NOT_PRESENT_BEFORE, after: faq.question || '(sem pergunta)' });
      return;
    }
    if (previous.question !== faq.question) entries.push({ label: 'Pergunta alterada', before: textOrEmpty(previous.question), after: textOrEmpty(faq.question) });
    if (previous.answer !== faq.answer) entries.push({ label: `Resposta — ${textOrEmpty(faq.question || previous.question)}`, before: textOrEmpty(previous.answer), after: textOrEmpty(faq.answer) });
  });
  beforeById.forEach((faq, id) => {
    if (!afterById.has(id)) entries.push({ label: 'Pergunta removida', before: faq.question || '(sem pergunta)', after: NOT_PRESENT_AFTER });
  });
  return entries;
}

/** Anexos e blocos de primeiro contato: resumo por contagem, não item a item — não são texto/preço que o agente cita direto pro cliente, então um resumo já dá pro admin perceber se algo mudou antes de publicar. */
function diffCountSummary(label: string, before: unknown, after: unknown): KnowledgeBaseDocumentDiffEntry[] {
  const beforeList = asArray<unknown>(before);
  const afterList = asArray<unknown>(after);
  if (JSON.stringify(beforeList) === JSON.stringify(afterList)) return [];
  return [{ label, before: `${beforeList.length} item(ns)`, after: `${afterList.length} item(ns)` }];
}

/**
 * Compara `data` publicado vs. `data` do rascunho de um tipo de documento.
 * Retorna lista vazia quando não há diferença (não deveria acontecer na
 * prática — um rascunho só existe quando algo foi salvo diferente do
 * publicado — mas fica seguro caso o rascunho seja idêntico por acaso).
 */
export function describeKnowledgeBaseDocumentDiff(
  documentType: KnowledgeBaseDocumentType,
  published: Record<string, unknown>,
  draft: Record<string, unknown>,
): KnowledgeBaseDocumentDiffEntry[] {
  switch (documentType) {
    case 'business_profile':
      return [
        ...diffTextField('Nome da empresa', published.companyName, draft.companyName),
        ...diffTextField('Objetivo do agente', published.agentGoal, draft.agentGoal),
        ...diffTextField('Modelo de negócio', published.businessModel, draft.businessModel),
        ...diffTextField('Link do Google Maps', published.locationMapsUrl, draft.locationMapsUrl),
      ];
    case 'brand_voice':
      return diffTextField('Tom de voz', published.toneOfVoice, draft.toneOfVoice);
    case 'service_catalog':
      return diffProducts(published.products, draft.products);
    case 'pricing_policies':
      return [
        ...diffTextField('Preços e políticas', published.pricingAndPolicies, draft.pricingAndPolicies),
        ...diffStringList('Regra de negócio', published.businessRules, draft.businessRules),
      ];
    case 'faq':
      return diffFaqs(published.faqs, draft.faqs);
    case 'media_assets':
      return [
        ...diffCountSummary('Documentos anexados', published.documents, draft.documents),
        ...diffCountSummary('Blocos de primeiro contato', published.firstContactBlocks, draft.firstContactBlocks),
      ];
    default:
      return [];
  }
}
