/**
 * Base de conhecimento do agente (objetivo, tom de voz, regras de negócio,
 * catálogo de preços, FAQ) — usada como contexto real nos prompts do Gemini
 * pra resposta automática. Migrado pra tabela Postgres `knowledge_base`
 * (Bloco 2.A), 1 registro (jsonb) por tenant_id.
 *
 * ISSUE-0096 — durante a transição, `getKnowledgeBase` continua lendo o
 * blob legado. As funções de documentos tipados abaixo existem para provar a
 * equivalência antes do corte explícito do runtime; nunca devem ser usadas
 * como fallback silencioso.
 */
import { getDb } from './db';

/** Comparação visual real de um procedimento, mantida inline como as fotos de exemplo da Base de Conhecimento. */
export interface BeforeAfterPair {
  id: string;
  beforeImageBase64: string;
  beforeImageMimeType?: string;
  afterImageBase64: string;
  afterImageMimeType?: string;
  caption?: string;
}

/**
 * Uma variante de tamanho/modelo dentro de um produto unificado (ex: catálogo
 * de piscinas — um produto "Acapulco" cobrindo AC F400/F500/F600, cada um com
 * preço próprio) — pedido real: unificar por família evita o agente mandar a
 * mesma foto de exemplo várias vezes na mesma conversa (a foto é uma só por
 * família), mas sem perder o preço específico de cada tamanho pro agente
 * vender de acordo com a especificação escolhida pelo cliente.
 */
export interface ProductVariant {
  /** Código/nome do modelo (ex: "AC F400" num catálogo de piscinas, ou "Lash Lift" numa família de serviços) — o que o agente cita pro cliente e usa pra bater com o nome do serviço pedido, ver findProductMatch. */
  code: string;
  /** Explicação comercial própria da variação (efeito, acabamento ou diferença), usada no catálogo público e no contexto do agente. */
  description?: string;
  /** Foto exclusiva desta variação, usada quando a cliente escolhe um efeito/modelo específico. */
  exampleImageBase64?: string;
  exampleImageMimeType?: string;
  /** Vídeo exclusivo desta variação, armazenado fora do JSON da Base de Conhecimento. */
  exampleVideoId?: string;
  exampleVideoMimeType?: string;
  exampleVideoFileName?: string;
  exampleVideoSizeBytes?: number;
  /** Mensagem comercial pré-preenchida do WhatsApp para uma consulta por esta variação. */
  whatsappMessage?: string;
  /** Resultados comparativos exclusivos desta variação. */
  beforeAfter?: BeforeAfterPair[];
  /** Medidas em texto livre (ex: "4,10x2,30m"), opcional. */
  dimensions?: string;
  /** Capacidade em litros, opcional. */
  litros?: number;
  price: string;
  /** Valor numérico do preço da variante — mesmo papel de AgentProduct.priceAmount, mas por tamanho. */
  priceAmount?: number;
  /** Promoção aplicada exclusivamente a esta variação até a data indicada. */
  promoPrice?: string;
  promoPriceAmount?: number;
  promoUntil?: string; // YYYY-MM-DD
  /**
   * Duração real desta variante em minutos — quando ausente, cai pro
   * durationMinutes do produto pai (ver findProductMatch/
   * findProductDurationMinutes abaixo). Necessário quando variantes da mesma
   * família têm durações diferentes (achado real, 20/08/2026: agrupar os
   * serviços de pestañas da Monique numa família só "Pestañas" sem isso
   * faria TODO agendamento usar a mesma duração do produto pai, errando o
   * fim do evento no Calendar pra variantes mais curtas/longas).
   */
  durationMinutes?: number;
  /** false = esta variante específica não é agendável sozinha, mesmo que o produto pai seja. Quando ausente, cai pro bookable do produto pai. */
  bookable?: boolean;
}

export interface AgentProduct {
  name: string;
  /** Nomes comerciais alternativos usados em anúncios e conversas. Mantém o nome oficial do catálogo, mas permite reconhecer campanhas como "Combo Full Face". */
  aliases?: string[];
  price: string;
  /** Agrupamento pro prompt (ex: "Pestañas", "Cejas") — opcional, catálogos pequenos podem ficar sem. */
  category?: string;
  /**
   * Também usado pelo runMidiaTool (autoReply.ts) pra ajudar o modelo a mapear
   * a mensagem do cliente pro produto certo quando o nome comercial sozinho
   * não basta — ex: variantes/medidas de uma mesma família ("MS F400,
   * 4,00x2,20m") que o cliente costuma citar em vez do nome ("o de 4 metros").
   */
  description?: string;
  /**
   * Tamanhos/modelos dessa família, cada um com preço próprio — quando
   * presente, o agente deve cotar pelo preço da variante escolhida em vez do
   * `price` genérico acima (que vira só um texto de fallback tipo "a partir
   * de" ou "sob consulta").
   */
  variants?: ProductVariant[];
  /** Foto de exemplo do serviço (data URI base64), pro operador/agente enviar quando o lead perguntar sobre esse serviço específico. */
  exampleImageBase64?: string;
  exampleImageMimeType?: string;
  /**
   * Vídeo de exemplo do serviço — ao contrário da foto (inline base64
   * acima), o binário fica no Storage (server/services/knowledgeBaseVideoStore.ts,
   * bucket "app-data", prefixo kb-video/{tenantId}/{videoId}); aqui só a
   * referência. Pedido real do dono do produto: vídeos geralmente de até
   * ~1 minuto, ainda mais persuasivo que foto pra mostrar o procedimento.
   */
  exampleVideoId?: string;
  exampleVideoMimeType?: string;
  exampleVideoFileName?: string;
  exampleVideoSizeBytes?: number;
  /** Resultados comparativos da família de serviços. */
  beforeAfter?: BeforeAfterPair[];
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
  /**
   * false = item pausado/descontinuado — nunca aparece no catálogo que vai
   * pro prompt do Gemini (ver formatKnowledgeBaseForPrompt) nem pode ser
   * oferecido/agendado pelo agente. Default true (undefined = ativo), pra
   * não quebrar catálogos existentes sem esse campo. Diferente de
   * `bookable`: um item pode estar ativo (visível/cotável) mas não
   * agendável por si só (ex: Retoque); `active: false` some do prompt
   * inteiro, não só do agendamento.
   */
  active?: boolean;
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
  // Produto com variantes: o `price` do produto-pai é só um cabeçalho/faixa
  // ("Gs 140.000 a Gs 350.000"), nunca um valor cobrável — o preço de
  // verdade está sempre na variante. Parsear esse texto como número
  // concatenaria os dois extremos da faixa (achado real, 26/08/2026).
  if (product.variants?.length) return 0;
  return parsePriceToNumber(resolveProductPrice(product, timezone));
}

/** Resolve o preço vigente de uma variação, sem transferir a promoção para outras variações da família. */
export function resolveVariantPrice(variant: ProductVariant, timezone = 'America/Asuncion'): string {
  if (!variant.promoPrice || !variant.promoUntil) return variant.price;
  const today = new Date().toLocaleDateString('en-CA', { timeZone: timezone });
  return today <= variant.promoUntil ? variant.promoPrice : variant.price;
}

/** Obtém o valor financeiro derivado do preço vigente da variação. */
export function resolveVariantPriceAmount(variant: ProductVariant, timezone = 'America/Asuncion'): number {
  if (variant.promoPriceAmount != null && variant.promoUntil) {
    const today = new Date().toLocaleDateString('en-CA', { timeZone: timezone });
    if (today <= variant.promoUntil) return variant.promoPriceAmount;
  }
  if (variant.priceAmount != null) return variant.priceAmount;
  return parsePriceToNumber(resolveVariantPrice(variant, timezone));
}

/** Converte um preço em texto (ex: "Gs 500.000") pro valor numérico (500000) — usado pra mandar `value` numérico ao Meta CAPI (Epic 4.5.6). Sem dígitos reconhecíveis, devolve 0 (nunca inventa um valor). */
export function parsePriceToNumber(priceText: string | undefined): number {
  if (!priceText) return 0;
  return parseInt(priceText.replace(/\D/g, ''), 10) || 0;
}

export interface ProductNameMatch {
  /** O produto pai (nível superior) — carrega foto/vídeo/descrição, sempre compartilhados pela família inteira mesmo quando o nome buscado bate numa variante específica. */
  product: AgentProduct;
  /** A variante que bateu com o nome buscado, se o nome não bateu direto no produto pai. */
  variant?: ProductVariant;
}

/**
 * Acha um produto do catálogo pelo nome exato (comparação normalizada:
 * trim + minúsculas) — procura primeiro no nível do produto, depois dentro
 * de `variants` de cada família. Fonte única usada por toda checagem de
 * duração/bookable/preço/mídia por nome de serviço (ver
 * isNonBookableProduct/findProductDurationMinutes/resolveProductAmountByName
 * abaixo, e os pontos em conversations.ts/autoReply.ts que mandam foto,
 * vídeo, registram a transação financeira e disparam o Meta CAPI).
 *
 * Achado real (20/08/2026): antes cada um desses 6 pontos reimplementava o
 * próprio `kb.products.find(p => p.name === nome)`, que nunca soube procurar
 * dentro de `variants` — agrupar produtos de uma família (ex: "Pestañas"
 * cobrindo "Lash Lift", "Efecto Delineado" etc.) quebraria silenciosamente
 * duração de agendamento, valor do registro financeiro e envio de foto/vídeo
 * assim que um serviço deixasse de ser um produto de topo.
 */
export function findProductMatch(kb: AgentKnowledgeBase | null, productName: string): ProductNameMatch | undefined {
  const normalized = productName.trim().toLowerCase();
  for (const product of kb?.products || []) {
    if (product.name.trim().toLowerCase() === normalized) return { product };
    const variant = product.variants?.find((v) => v.code.trim().toLowerCase() === normalized);
    if (variant) return { product, variant };
  }
  return undefined;
}

/** true quando o nome bate com um produto (ou variante) do catálogo marcado como não-agendável (ex: Retoque) — usado pra recusar `criar_agendamento` nesse serviço e orientar pra avaliação humana em vez de deixar o cliente marcar um turno por conta própria. */
export function isNonBookableProduct(kb: AgentKnowledgeBase | null, productName: string): boolean {
  const match = findProductMatch(kb, productName);
  if (!match) return false;
  // Item pausado (active:false) nunca é agendável, mesmo que bookable não
  // diga o contrário — defesa extra caso o nome ainda apareça no histórico
  // da conversa depois de a empresa desativar o item.
  if (match.product.active === false) return true;
  const bookable = match.variant?.bookable ?? match.product.bookable;
  return bookable === false;
}

/** Duração real (minutos) de um produto (ou variante) do catálogo pelo nome exato — usada pra calcular o fim do evento no Google Calendar em vez do fallback fixo de 90min pra qualquer serviço. Variante sem duração própria cai pra do produto pai. */
export function findProductDurationMinutes(kb: AgentKnowledgeBase | null, productName: string): number | undefined {
  const match = findProductMatch(kb, productName);
  return match?.variant?.durationMinutes ?? match?.product.durationMinutes;
}

/**
 * Valor numérico do preço vigente de um produto (ou variante) pelo nome
 * exato — usado pro registro financeiro automático e pro Meta CAPI, onde só
 * se tem o nome do serviço (título do evento do Calendar), nunca o objeto
 * do produto direto. Variante usa o preço/promoção próprios quando
 * presentes; sem variante batendo, cai pro resolveProductPriceAmount normal
 * do produto pai. undefined quando o nome não bate com nada no catálogo
 * (nunca inventa um valor).
 */
export function resolveProductAmountByName(kb: AgentKnowledgeBase | null, productName: string, timezone = 'America/Asuncion'): number | undefined {
  const match = findProductMatch(kb, productName);
  if (!match) return undefined;
  if (match.variant) {
    return resolveVariantPriceAmount(match.variant, timezone);
  }
  return resolveProductPriceAmount(match.product, timezone);
}

/**
 * Todos os `videoId` (Storage, knowledgeBaseVideoStore.ts) referenciados
 * nesta KB — issue #261: usado pra só apagar um vídeo do Storage depois que
 * a troca foi salva de fato (POST /api/knowledge-base em conversations.ts),
 * nunca no momento do upload em si. Antes, trocar o vídeo de um produto/bloco
 * de 1º contato sem clicar em "Salvar Regras no Agente" (fechar a aba,
 * queda de conexão etc.) apagava o vídeo ANTIGO do Storage imediatamente no
 * upload, mesmo que a referência NOVA nunca chegasse a ser persistida —
 * deixando a KB salva com uma referência órfã, apontando pra um arquivo que
 * não existe mais.
 */
export function collectReferencedVideoIds(kb: AgentKnowledgeBase | null): Set<string> {
  const ids = new Set<string>();
  for (const product of kb?.products || []) {
    if (product.exampleVideoId) ids.add(product.exampleVideoId);
    for (const variant of product.variants || []) {
      if (variant.exampleVideoId) ids.add(variant.exampleVideoId);
    }
  }
  for (const block of kb?.firstContactBlocks || []) {
    if (block.videoId) ids.add(block.videoId);
  }
  return ids;
}

export type FirstContactBlockType = 'text' | 'image' | 'video' | 'file';

/**
 * Um passo da sequência de "1º contato" — pedido real (15/08/2026, Clic
 * Piscinas): a mensagem fixa precisa poder intercalar texto/vídeo/texto (ou
 * qualquer outra ordem, ex: um catálogo em PDF), não só um texto + uma
 * imagem + um vídeo soltos numa ordem fixa. `order` (índice no array
 * `firstContactBlocks`, ver AgentKnowledgeBase abaixo) é quem decide a
 * sequência de envio real — cada bloco carrega só os campos do seu próprio
 * `type`.
 */
export interface FirstContactBlock {
  id: string;
  type: FirstContactBlockType;
  /** Só pra type === 'text'. */
  text?: string;
  /** Só pra type === 'image' — inline (data URI base64), mesmo padrão de AgentProduct.exampleImageBase64. */
  imageBase64?: string;
  imageMimeType?: string;
  /** Só pra type === 'video' — Storage (knowledgeBaseVideoStore.ts), aqui só a referência, mesmo padrão de AgentProduct.exampleVideoId. */
  videoId?: string;
  videoMimeType?: string;
  videoFileName?: string;
  videoSizeBytes?: number;
  /** Legenda opcional do vídeo — vai junto na MESMA mensagem de mídia (caption real da Meta/Evolution), não como um bloco de texto separado. */
  videoCaption?: string;
  /** Só pra type === 'file' (ex: catálogo em PDF) — Storage (knowledgeBaseDocumentStore.ts), aqui só a referência. Desacoplado da lista de "Documentos Anexados" (AgentFileDoc): não entra como contexto de leitura da IA, só é enviado como arquivo real pro cliente. */
  fileId?: string;
  fileMimeType?: string;
  fileName?: string;
  fileSizeBytes?: number;
}


export interface AgentFAQ {
  question: string;
  answer: string;
}

export interface AgentFileDoc {
  id: string;
  fileName: string;
  fileSize: string;
  /** Tamanho real em bytes — usado pra somar o total ocupado pelo tenant (ver MAX_TOTAL_BYTES_PER_TENANT em conversations.ts); `fileSize` é só o texto formatado pra exibição. */
  sizeBytes?: number;
  mimeType?: string;
  uploadDate: string;
  status: 'Processado' | 'Pendente';
  /**
   * Texto extraído do arquivo (PDF/TXT/CSV/JSON/MD), já truncado — fonte
   * real que formatKnowledgeBaseForPrompt injeta no prompt do agente.
   * Ausente pra tipos sem extração implementada (ex: DOCX) ou quando a
   * extração falhou; nesse caso o documento fica só como anexo/registro,
   * sem o agente "ler" o conteúdo.
   */
  extractedText?: string;
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
  documents?: AgentFileDoc[];
  /**
   * Link de localização (Google Maps) pro agente mandar quando o cliente
   * pedir o endereço/localização — texto livre em `businessModel` descreve
   * o endereço, mas não é algo clicável/navegável no WhatsApp. Aceita tanto
   * um link real (share link do Google Maps) quanto uma URL de busca
   * gerada a partir do endereço (`https://www.google.com/maps/search/?api=1&query=...`),
   * que funciona sem precisar de coordenadas exatas.
   */
  locationMapsUrl?: string;
  /** Sequência fixa de "1º contato" (texto/imagem/vídeo/arquivo, na ordem do array) — ver FirstContactBlock acima. Ausente/vazio = comportamento de sempre. */
  firstContactBlocks?: FirstContactBlock[];
}

/** Tipos de documento permitidos pela migration 0057 e pelo contrato da API. */
export const KNOWLEDGE_BASE_DOCUMENT_TYPES = [
  'business_profile',
  'brand_voice',
  'service_catalog',
  'pricing_policies',
  'opening_hours',
  'faq',
  'human_handoff_rules',
  'media_assets',
] as const;

export type KnowledgeBaseDocumentType = (typeof KNOWLEDGE_BASE_DOCUMENT_TYPES)[number];
export type KnowledgeBaseDocumentStatus = 'draft' | 'published' | 'archived';

/**
 * Registro normalizado da tabela `knowledge_base_documents`.
 *
 * O payload permanece `Record<string, unknown>` no limite com o banco. A
 * composição seleciona estritamente os campos permitidos para cada tipo, em
 * vez de confiar no conteúdo arbitrário de um JSONB.
 */
export interface KnowledgeBaseDocument {
  id: string;
  tenantId: string;
  documentType: KnowledgeBaseDocumentType;
  version: number;
  status: KnowledgeBaseDocumentStatus;
  data: Record<string, unknown>;
  createdAt?: string;
  updatedAt?: string;
  publishedAt?: string | null;
}

type KnowledgeBaseDocumentRow = {
  id: string;
  tenant_id: string;
  document_type: KnowledgeBaseDocumentType;
  version: number;
  status: KnowledgeBaseDocumentStatus;
  data: Record<string, unknown>;
  created_at?: string;
  updated_at?: string;
  published_at?: string | null;
};

const KNOWLEDGE_BASE_DOCUMENT_FIELDS: Record<KnowledgeBaseDocumentType, readonly (keyof AgentKnowledgeBase)[]> = {
  business_profile: ['companyName', 'agentGoal', 'businessModel', 'locationMapsUrl'],
  brand_voice: ['toneOfVoice'],
  service_catalog: ['products'],
  pricing_policies: ['pricingAndPolicies', 'businessRules'],
  opening_hours: [],
  faq: ['faqs'],
  human_handoff_rules: [],
  media_assets: ['documents', 'firstContactBlocks'],
};

const KNOWLEDGE_BASE_DOCUMENT_DATA_KEYS: Record<KnowledgeBaseDocumentType, readonly string[]> = {
  business_profile: ['companyName', 'agentGoal', 'businessModel', 'locationMapsUrl'],
  brand_voice: ['toneOfVoice'],
  service_catalog: ['products'],
  pricing_policies: ['pricingAndPolicies', 'businessRules'],
  opening_hours: [],
  faq: ['faqs'],
  human_handoff_rules: [],
  media_assets: ['documents', 'firstContactBlocks'],
};

export class KnowledgeBaseDocumentValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'KnowledgeBaseDocumentValidationError';
  }
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function assertString(value: unknown, field: string): void {
  if (typeof value !== 'string') throw new KnowledgeBaseDocumentValidationError(`Campo "${field}" precisa ser texto.`);
}

function assertStringArray(value: unknown, field: string): void {
  if (!Array.isArray(value) || !value.every((item) => typeof item === 'string')) {
    throw new KnowledgeBaseDocumentValidationError(`Campo "${field}" precisa ser uma lista de textos.`);
  }
}

function assertProducts(value: unknown): void {
  if (!Array.isArray(value)) throw new KnowledgeBaseDocumentValidationError('Campo "products" precisa ser uma lista.');
  for (const [index, product] of value.entries()) {
    if (!isPlainRecord(product)) throw new KnowledgeBaseDocumentValidationError(`products[${index}] precisa ser um objeto.`);
    assertString(product.name, `products[${index}].name`);
    assertString(product.price, `products[${index}].price`);
    if (product.variants !== undefined) {
      if (!Array.isArray(product.variants)) throw new KnowledgeBaseDocumentValidationError(`products[${index}].variants precisa ser uma lista.`);
      for (const [variantIndex, variant] of product.variants.entries()) {
        if (!isPlainRecord(variant)) throw new KnowledgeBaseDocumentValidationError(`products[${index}].variants[${variantIndex}] precisa ser um objeto.`);
        assertString(variant.code, `products[${index}].variants[${variantIndex}].code`);
        assertString(variant.price, `products[${index}].variants[${variantIndex}].price`);
      }
    }
  }
}

function assertFaqs(value: unknown): void {
  if (!Array.isArray(value)) throw new KnowledgeBaseDocumentValidationError('Campo "faqs" precisa ser uma lista.');
  for (const [index, faq] of value.entries()) {
    if (!isPlainRecord(faq)) throw new KnowledgeBaseDocumentValidationError(`faqs[${index}] precisa ser um objeto.`);
    assertString(faq.question, `faqs[${index}].question`);
    assertString(faq.answer, `faqs[${index}].answer`);
  }
}

/**
 * Valida o contrato de cada documento no limite da API. Campos não previstos
 * são rejeitados em vez de serem persistidos sem semântica; campos sem fonte
 * estruturada continuam explicitamente vazios até uma evolução aprovada.
 */
export function validateKnowledgeBaseDocumentData(documentType: KnowledgeBaseDocumentType, value: unknown): Record<string, unknown> {
  if (!isPlainRecord(value)) throw new KnowledgeBaseDocumentValidationError('Campo "data" precisa ser um objeto JSON.');

  const allowedKeys = KNOWLEDGE_BASE_DOCUMENT_DATA_KEYS[documentType];
  const unknownKeys = Object.keys(value).filter((key) => !allowedKeys.includes(key));
  if (unknownKeys.length) {
    throw new KnowledgeBaseDocumentValidationError(`Campo(s) não permitido(s) em ${documentType}: ${unknownKeys.join(', ')}.`);
  }

  switch (documentType) {
    case 'business_profile':
      for (const field of allowedKeys) if (value[field] !== undefined) assertString(value[field], field);
      break;
    case 'brand_voice':
      if (value.toneOfVoice !== undefined) assertString(value.toneOfVoice, 'toneOfVoice');
      break;
    case 'service_catalog':
      if (value.products !== undefined) assertProducts(value.products);
      break;
    case 'pricing_policies':
      if (value.pricingAndPolicies !== undefined) assertString(value.pricingAndPolicies, 'pricingAndPolicies');
      if (value.businessRules !== undefined) assertStringArray(value.businessRules, 'businessRules');
      break;
    case 'faq':
      if (value.faqs !== undefined) assertFaqs(value.faqs);
      break;
    case 'media_assets':
      if (value.documents !== undefined && !Array.isArray(value.documents)) {
        throw new KnowledgeBaseDocumentValidationError('Campo "documents" precisa ser uma lista.');
      }
      if (value.firstContactBlocks !== undefined && !Array.isArray(value.firstContactBlocks)) {
        throw new KnowledgeBaseDocumentValidationError('Campo "firstContactBlocks" precisa ser uma lista.');
      }
      break;
    case 'opening_hours':
    case 'human_handoff_rules':
      break;
  }

  return value;
}

export function parseKnowledgeBaseDocumentType(value: string): KnowledgeBaseDocumentType {
  if (!(KNOWLEDGE_BASE_DOCUMENT_TYPES as readonly string[]).includes(value)) {
    throw new KnowledgeBaseDocumentValidationError(`Tipo de documento inválido: ${value}.`);
  }
  return value as KnowledgeBaseDocumentType;
}

function normalizeKnowledgeBaseDocument(row: KnowledgeBaseDocumentRow): KnowledgeBaseDocument {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    documentType: row.document_type,
    version: row.version,
    status: row.status,
    data: row.data || {},
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    publishedAt: row.published_at,
  };
}

/**
 * Reconstrói a forma legada da KB a partir de documentos publicados. Só os
 * campos pertencentes ao tipo de documento são aceitos, preservando produtos,
 * variantes, mídias e regras exatamente como foram persistidos. A função é
 * pura para viabilizar testes de equivalência sem depender do banco.
 */
export function composeKnowledgeBaseDocuments(documents: readonly KnowledgeBaseDocument[]): AgentKnowledgeBase {
  const composed: AgentKnowledgeBase = {};
  const target = composed as Record<string, unknown>;

  for (const document of documents) {
    if (document.status !== 'published') continue;
    for (const field of KNOWLEDGE_BASE_DOCUMENT_FIELDS[document.documentType]) {
      const value = document.data[field];
      if (value !== undefined) target[field] = value;
    }
  }

  return composed;
}

/** Lista somente as versões publicadas do tenant autenticado no banco. */
export async function getPublishedKnowledgeBaseDocuments(tenantId: string): Promise<KnowledgeBaseDocument[]> {
  const db = getDb();
  const { data, error } = await db
    .from('knowledge_base_documents')
    .select('id, tenant_id, document_type, version, status, data, created_at, updated_at, published_at')
    .eq('tenant_id', tenantId)
    .eq('status', 'published')
    .order('document_type', { ascending: true });
  if (error) throw error;
  return ((data || []) as KnowledgeBaseDocumentRow[]).map(normalizeKnowledgeBaseDocument);
}

/** Composição de conveniência usada apenas por testes e futuros endpoints da etapa de publicação. */
export async function composePublishedKnowledgeBase(tenantId: string): Promise<AgentKnowledgeBase> {
  return composeKnowledgeBaseDocuments(await getPublishedKnowledgeBaseDocuments(tenantId));
}

export interface KnowledgeBaseDocumentState {
  documentType: KnowledgeBaseDocumentType;
  published: KnowledgeBaseDocument | null;
  draft: KnowledgeBaseDocument | null;
}

export interface KnowledgeBaseDocumentEvent {
  id: string;
  tenantId: string;
  documentId: string;
  documentType: KnowledgeBaseDocumentType;
  version: number;
  eventType: 'draft_created' | 'draft_updated' | 'published';
  actorId: string | null;
  createdAt: string;
}

type KnowledgeBaseDocumentEventRow = {
  id: string;
  tenant_id: string;
  document_id: string;
  document_type: KnowledgeBaseDocumentType;
  version: number;
  event_type: KnowledgeBaseDocumentEvent['eventType'];
  actor_id: string | null;
  created_at: string;
};

function normalizeKnowledgeBaseDocumentEvent(row: KnowledgeBaseDocumentEventRow): KnowledgeBaseDocumentEvent {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    documentId: row.document_id,
    documentType: row.document_type,
    version: row.version,
    eventType: row.event_type,
    actorId: row.actor_id,
    createdAt: row.created_at,
  };
}

const DOCUMENT_SELECT_COLUMNS = 'id, tenant_id, document_type, version, status, data, created_at, updated_at, published_at';

/** Visão de edição: somente a publicação vigente e o rascunho do tenant. */
export async function listKnowledgeBaseDocumentStates(tenantId: string): Promise<KnowledgeBaseDocumentState[]> {
  const db = getDb();
  const { data, error } = await db
    .from('knowledge_base_documents')
    .select(DOCUMENT_SELECT_COLUMNS)
    .eq('tenant_id', tenantId)
    .in('status', ['published', 'draft'])
    .order('document_type', { ascending: true });
  if (error) throw error;

  const liveDocuments = ((data || []) as KnowledgeBaseDocumentRow[]).map(normalizeKnowledgeBaseDocument);
  return KNOWLEDGE_BASE_DOCUMENT_TYPES.map((documentType) => ({
    documentType,
    published: liveDocuments.find((document) => document.documentType === documentType && document.status === 'published') || null,
    draft: liveDocuments.find((document) => document.documentType === documentType && document.status === 'draft') || null,
  }));
}

export async function getKnowledgeBaseDocumentState(tenantId: string, documentType: KnowledgeBaseDocumentType): Promise<KnowledgeBaseDocumentState> {
  const states = await listKnowledgeBaseDocumentStates(tenantId);
  return states.find((state) => state.documentType === documentType)!;
}

/** Cria ou atualiza exclusivamente o rascunho, sem tocar em publicação. */
export async function saveKnowledgeBaseDocumentDraft(
  tenantId: string,
  documentType: KnowledgeBaseDocumentType,
  data: Record<string, unknown>,
  actorId: string,
): Promise<KnowledgeBaseDocument> {
  const validatedData = validateKnowledgeBaseDocumentData(documentType, data);
  const db = getDb();
  const { data: saved, error } = await db
    .rpc('save_knowledge_base_document_draft', {
      p_document_type: documentType,
      p_data: validatedData,
      p_actor_id: actorId,
    })
    .single();
  if (error) throw error;
  const document = normalizeKnowledgeBaseDocument(saved as KnowledgeBaseDocumentRow);
  // RLS também limita o RPC ao tenant do JWT. Esta defesa local torna uma
  // configuração incorreta de contexto visível em testes/desenvolvimento.
  if (document.tenantId !== tenantId) throw new Error('RPC retornou documento de outro tenant — operação recusada.');
  return document;
}

/** Publica pelo RPC transacional da migration 0058; o banco também confere RBAC e ator. */
export async function publishKnowledgeBaseDocument(
  tenantId: string,
  documentType: KnowledgeBaseDocumentType,
  actorId: string,
): Promise<KnowledgeBaseDocument> {
  const db = getDb();
  const { data, error } = await db
    .rpc('publish_knowledge_base_document', { p_document_type: documentType, p_actor_id: actorId })
    .single();
  if (error) throw error;
  const document = normalizeKnowledgeBaseDocument(data as KnowledgeBaseDocumentRow);
  if (document.tenantId !== tenantId) throw new Error('RPC retornou documento de outro tenant — operação recusada.');
  return document;
}

/** Histórico auditável do tipo, sempre limitado pelo RLS do tenant atual. */
export async function listKnowledgeBaseDocumentEvents(tenantId: string, documentType: KnowledgeBaseDocumentType): Promise<KnowledgeBaseDocumentEvent[]> {
  const db = getDb();
  const { data, error } = await db
    .from('knowledge_base_document_events')
    .select('id, tenant_id, document_id, document_type, version, event_type, actor_id, created_at')
    .eq('tenant_id', tenantId)
    .eq('document_type', documentType)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return ((data || []) as KnowledgeBaseDocumentEventRow[]).map(normalizeKnowledgeBaseDocumentEvent);
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

/**
 * Orçamento total de caracteres pra todo o conteúdo extraído de documentos,
 * somado — nunca por documento individual. Sem esse teto, um catálogo em
 * PDF de várias páginas (ou vários documentos anexados) infla o prompt sem
 * limite, exatamente o problema encontrado numa auditoria anterior (agentGoal
 * chegando a ~4.000 tokens sozinho). Documentos mais recentes entram
 * primeiro; o resto é cortado com aviso explícito, nunca silenciosamente.
 */
const DOCUMENTS_PROMPT_CHAR_BUDGET = 3000;

function formatDocumentsForPrompt(documents: AgentFileDoc[] | undefined): string {
  const withText = (documents || []).filter((d) => d.extractedText?.trim());
  if (!withText.length) return '';

  const parts: string[] = [];
  let remaining = DOCUMENTS_PROMPT_CHAR_BUDGET;
  for (const doc of withText) {
    if (remaining <= 0) {
      parts.push(`(mais ${withText.length - parts.length} documento(s) anexado(s), não incluído(s) aqui por limite de tamanho — consulte o arquivo original se precisar)`);
      break;
    }
    const text = doc.extractedText!.trim();
    const excerpt = text.length > remaining ? `${text.slice(0, remaining)}… [documento truncado]` : text;
    remaining -= excerpt.length;
    parts.push(`Documento "${doc.fileName}":\n${excerpt}`);
  }
  return `Documentos anexados (use como referência adicional, nunca acima do catálogo/políticas quando houver conflito):\n\n${parts.join('\n\n')}`;
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
  if (kb.locationMapsUrl) parts.push(`Link de localização (Google Maps) — mande esse link exatamente como está, sem alterar, sempre que o cliente pedir o endereço/localização: ${kb.locationMapsUrl}`);
  if (kb.pricingAndPolicies) parts.push(`Políticas de preço/pagamento: ${kb.pricingAndPolicies}`);
  if (kb.businessRules?.length) parts.push(`Regras de negócio:\n- ${kb.businessRules.join('\n- ')}`);
  // Item com active:false é pausado/descontinuado — nunca entra no prompt,
  // então o agente nunca pode ofertar/cotar/agendar algo que a empresa
  // marcou como fora do ar (mesma lógica de nunca fabricar dado de negócio
  // documentada acima pro businessModel, aplicada aqui pra visibilidade).
  const visibleProducts = kb.products?.filter((p) => p.active !== false) || [];
  if (visibleProducts.length) {
    const line = (p: AgentProduct) => {
      const variantsLine = p.variants?.length
        ? `\n  Tamanhos/modelos disponíveis (cote SEMPRE o preço do tamanho específico escolhido pelo cliente, nunca o preço genérico do produto):\n${p.variants
            .map((v) => `    • ${v.code}${v.dimensions ? ` (${v.dimensions}${v.litros ? `, ${v.litros}L` : ''})` : ''}: ${resolveVariantPrice(v)}${v.description?.trim() ? ` — ${v.description.trim()}` : ''}`)
            .join('\n')}`
        : '';
      const aliasesLine = p.aliases?.length ? ` — também conhecido como ${p.aliases.join(', ')}` : '';
      return `- ${p.name}${aliasesLine}: ${resolveProductPrice(p)}${p.description ? ` — ${p.description}` : ''}${variantsLine}`;
    };
    const categories = [...new Set(visibleProducts.map((p) => p.category).filter((c): c is string => !!c))];
    if (categories.length) {
      const uncategorized = visibleProducts.filter((p) => !p.category);
      const grouped = categories
        .map((cat) => `${cat}:\n${visibleProducts.filter((p) => p.category === cat).map(line).join('\n')}`)
        .concat(uncategorized.length ? [`Outros:\n${uncategorized.map(line).join('\n')}`] : []);
      parts.push(`Catálogo de produtos/serviços:\n${grouped.join('\n\n')}`);
    } else {
      parts.push(`Catálogo de produtos/serviços:\n${visibleProducts.map(line).join('\n')}`);
    }
  }
  if (kb.faqs?.length) {
    parts.push(`Perguntas frequentes:\n${kb.faqs.map((f) => `P: ${f.question}\nR: ${f.answer}`).join('\n')}`);
  }
  const documentsContext = formatDocumentsForPrompt(kb.documents);
  if (documentsContext) parts.push(documentsContext);

  if (!parts.length) return '';
  return `\nContexto real do negócio (use essas informações pra responder com precisão, nunca invente preços/regras fora daqui):\n${parts.join('\n\n')}\n`;
}
