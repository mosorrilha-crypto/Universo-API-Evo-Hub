export type ActiveTab = 'whatsapp' | 'crm' | 'financial' | 'agenda_financeiro' | 'saas' | 'attribution' | 'knowledge' | 'integration' | 'escalations';

export type UserRole = 'operator' | 'manager' | 'admin' | 'saas_admin';

export type TenantPlan = 'starter' | 'pro' | 'enterprise';
export type TenantStatus = 'ativo' | 'trial' | 'suspenso' | 'cancelado';

export type WhatsAppEngineType = 'evolution_vps' | 'zapi_managed' | 'meta_cloud_api';

export interface Tenant {
  id: string;
  name: string;
  slug: string
  logoUrl?: string;
  plan: TenantPlan;
  monthlyMRR: number; // in BRL
  status: TenantStatus;
  createdAt: string;
  whatsappPhone: string;
  whatsappStatus: 'conectado' | 'desconectado' | 'qr_pendente';
  whatsappEngine: WhatsAppEngineType; // Strategy Engine
  evolutionInstanceName?: string;
  zapiInstanceId?: string;
  zapiToken?: string;
  metaCloudPhoneId?: string;
  failoverEnabled?: boolean;
  autoReconnectCount?: number;
  maxLeadsPerMonth: number;
  currentLeadsMonth: number;
  customGeminiKey?: string;
  metaPixelId?: string;
  webhookEndpoint: string;
  /** Moeda real do negócio deste tenant (ex: "PYG") — vem de GET /api/tenant. Financeiro usa isso pra formatar valores em vez de R$/pt-BR fixo. Ausente até essa chamada resolver, então todo consumidor precisa de um fallback. */
  currency?: string;
  /** Locale pra Intl.NumberFormat junto de `currency` (ex: "es-PY"). */
  locale?: string;
}

export interface UserProfile {
  id: string;
  tenantId: string;
  name: string;
  email: string;
  role: UserRole;
  avatar: string;
  department: string;
  shift?: string;
}

export type CRMStage = 'novo' | 'contato' | 'proposta' | 'negociacao' | 'ganho' | 'perdido';

export interface CRMOperatorNote {
  id: string;
  authorName: string;
  text: string;
  createdAt: string;
}

export interface CRMTask {
  id: string;
  title: string;
  dueDate: string;
  completed: boolean;
  assignedOperator: string;
}

export type PaymentMethod = 'PIX' | 'Transferência Bancária' | 'Cartão de Crédito' | 'Boleto Bancário' | 'Link WhatsApp';
export type PaymentStatus = 'pago' | 'pendente' | 'atrasado' | 'cancelado';

export interface FinancialTransaction {
  id: string;
  tenantId?: string;
  leadId: string;
  leadName: string;
  leadPhone: string;
  productName: string;
  /** Valor na moeda do tenant (Tenant.currency) — nunca assuma BRL, ver FinancialDashboard.tsx pra formatação. */
  amount: number;
  paymentMethod: PaymentMethod;
  status: PaymentStatus;
  date: string;
  operatorName: string;
  channel: string;
  pixQrCode?: string;
  paymentLinkUrl?: string;
  /** true quando veio de GET /api/financial/transactions (registro real persistido no servidor) — distingue de dado de demonstração local, mesmo papel que LeadInfo.isReal. */
  isReal?: boolean;
  /** Referência estável da origem (ex: "apt:<eventId>") — só presente em transação criada automaticamente pelo backend quando um comprovante é aprovado. undefined em transação registrada manualmente. */
  sourceRef?: string;
  /** Receita vinculada a atendimento/cobrança ou despesa operacional avulsa. Registros legados são receita por padrão. */
  entryType?: 'income' | 'expense';
}

export type LeadSourceChannel = 'meta_ads' | 'instagram_ads' | 'google_ads' | 'instagram_organic' | 'google_organic' | 'whatsapp_direct';

export interface UTMParams {
  utm_source?: string;
  utm_medium?: string;
  utm_campaign?: string;
  utm_content?: string;
  utm_term?: string;
  fbclid?: string;
  gclid?: string;
}

export interface AdDetails {
  campaignName?: string;
  adSetName?: string;
  adName?: string;
  adId?: string;
  spendEstimate?: number;
}

export interface MetaCAPIEvent {
  id: string;
  leadId: string;
  leadName: string;
  eventName: 'Lead' | 'Contact' | 'QualifiedLead' | 'Schedule' | 'PurchaseIntention' | 'Purchase';
  eventTime: string;
  pixelId: string;
  status: 'sent' | 'simulated_ok' | 'error';
  testEventCode?: string;
  /** Meta não retorna essa métrica síncrona na resposta da Conversions API — só fica visível no Events Manager. Ausente em eventos reais. */
  matchQualityScore?: number;
  userHash: {
    phoneHash: string;
    emailHash?: string;
    fbc?: string;
    fbp?: string;
  };
  eventValue?: number;
  responsePayload?: any;
}

export interface CAPIConfig {
  pixelId: string;
  accessToken: string;
  testEventCode: string;
  autoSendOnQualification: boolean;
  enabled: boolean;
}

export interface LeadAttribution {
  sourceChannel: LeadSourceChannel;
  channelLabel: string;
  campaignName?: string;
  adName?: string;
  utmParams?: UTMParams;
  adDetails?: AdDetails;
  capiEvents?: MetaCAPIEvent[];
}

/** Uma variante de tamanho/modelo dentro de um produto unificado — ver AgentProduct.variants. */
export interface ProductVariant {
  /** Nome/código da variante — o que o agente cita pro cliente e usa pra bater com o nome do serviço pedido (ex: "AC F400" num catálogo de piscinas, ou "Lash Lift" numa família de serviços). */
  code: string;
  dimensions?: string;
  litros?: number;
  price: string;
  priceAmount?: number;
  /** Preço promocional específico desta variação, ativo somente até promoUntil. */
  promoPrice?: string;
  promoPriceAmount?: number;
  promoUntil?: string;
  /** Duração real desta variante em minutos — quando ausente, cai pro durationMinutes do produto pai (ver findProductDurationMinutes em knowledgeBaseStore.ts). Necessário quando variantes da mesma família têm durações diferentes (ex: Lash Lift 90min vs Efecto Delineado 120min). */
  durationMinutes?: number;
  /** false = esta variante específica não é agendável sozinha, mesmo que o produto pai seja. Quando ausente, cai pro bookable do produto pai. */
  bookable?: boolean;
}

export interface AgentProduct {
  id: string;
  name: string;
  /** Nomes comerciais alternativos, usados para reconhecer campanhas e a forma como a cliente nomeia o serviço. */
  aliases?: string[];
  price: string;
  description: string;
  /** Agrupamento pro prompt do agente e pra listagem do painel (ex: "Pestañas", "Cejas") — opcional, catálogos pequenos podem ficar sem (ver server/services/knowledgeBaseStore.ts formatKnowledgeBaseForPrompt). */
  category?: string;
  /** Tamanhos/modelos dessa família, cada um com preço próprio (ver server/services/knowledgeBaseStore.ts). */
  variants?: ProductVariant[];
  exampleImageBase64?: string;
  exampleImageMimeType?: string;
  /**
   * Vídeo de exemplo do serviço — diferente da foto (exampleImageBase64,
   * guardada inline como base64), o vídeo fica no Storage do backend
   * (server/services/knowledgeBaseVideoStore.ts) e aqui só guarda a
   * referência (id opaco), pra nunca repetir o incidente real de produção
   * documentado em App.tsx (base64 de imagem já estourou a cota de
   * localStorage — vídeo inline seria dramaticamente pior).
   */
  exampleVideoId?: string;
  exampleVideoMimeType?: string;
  exampleVideoFileName?: string;
  exampleVideoSizeBytes?: number;
  promoPrice?: string;
  promoUntil?: string;
  /** Valor numérico do preço regular (Etapa 2 do roadmap) — opcional, fonte de verdade pra cálculo quando preenchido. */
  priceAmount?: number;
  currency?: string;
  /** Duração real da sessão em minutos — usada pro agente calcular o fim do evento no Google Calendar em vez de um fallback fixo. */
  durationMinutes?: number;
  /** false = não é um serviço agendável por si só (ex: Retoque). Default true (undefined = agendável). */
  bookable?: boolean;
  /** false = item pausado/descontinuado — some do catálogo que vai pro prompt do agente (nunca ofertado/cotado/agendado). Default true (undefined = ativo). */
  active?: boolean;
}

export type FirstContactBlockType = 'text' | 'image' | 'video' | 'file';

/**
 * Um passo da sequência de "1º contato" — enviado automaticamente na 1ª
 * mensagem de uma conversa nova, em vez da pergunta de triagem padrão da IA
 * (ver server/services/firstContactMessage.ts). `firstContactBlocks`
 * (abaixo) é um array ORDENADO: a sequência de envio real segue a ordem do
 * array, permitindo intercalar texto/vídeo/texto/arquivo do jeito que o
 * tenant quiser. Cada bloco só usa os campos do seu próprio `type`. Array
 * vazio/ausente = comportamento de sempre (a IA responde a 1ª mensagem
 * normalmente).
 */
export interface FirstContactBlock {
  id: string;
  type: FirstContactBlockType;
  text?: string;
  imageBase64?: string;
  imageMimeType?: string;
  videoId?: string;
  videoMimeType?: string;
  videoFileName?: string;
  videoSizeBytes?: number;
  /** Legenda opcional do vídeo — vai na MESMA mensagem de mídia (caption real), não como um bloco de texto separado. */
  videoCaption?: string;
  /** Arquivo genérico (ex: catálogo em PDF) — Storage (knowledgeBaseDocumentStore.ts), aqui só a referência. Desacoplado de AgentFileDoc/"Documentos Anexados": nunca vira contexto de leitura da IA, só é enviado como arquivo real pro cliente. */
  fileId?: string;
  fileMimeType?: string;
  fileName?: string;
  fileSizeBytes?: number;
}

export interface AgentFAQ {
  id: string;
  question: string;
  answer: string;
}

export interface AgentFileDoc {
  id: string;
  fileName: string;
  fileSize: string;
  /** Tamanho real em bytes — usado só pra somar o total ocupado pelo tenant na UI. */
  sizeBytes?: number;
  mimeType?: string;
  uploadDate: string;
  status: 'Processado' | 'Pendente';
  /** Presença indica que o agente consegue usar o conteúdo deste documento como contexto real (ver formatKnowledgeBaseForPrompt no backend) — ausente pra tipos sem extração (ex: DOCX), aí o documento fica só como anexo. */
  extractedText?: string;
}

/** "HH:mm" de abertura/fechamento de um dia específico. */
export interface DayHours {
  open: string;
  close: string;
}

/** Chaveado por dia da semana ("0" domingo .. "6" sábado) — dia ausente = tenant não atende nesse dia. Mesmo formato de server/services/tenantProfileStore.ts. */
export type BusinessHours = Partial<Record<string, DayHours>>;

export interface AgentKnowledgeBase {
  companyName: string;
  agentGoal: string;
  toneOfVoice: string;
  businessModel: string;
  pricingAndPolicies: string;
  products: AgentProduct[];
  businessRules: string[];
  faqs: AgentFAQ[];
  documents: AgentFileDoc[];
  /** Link de localização (Google Maps) que o agente manda quando o cliente pede o endereço — ver server/services/knowledgeBaseStore.ts. */
  locationMapsUrl?: string;
  firstContactBlocks?: FirstContactBlock[];
  lastSaved?: string;
}

export type MessageSender = 'lead' | 'agent' | 'system';
export type MessageType = 'text' | 'audio' | 'image' | 'file';

export interface MessageReaction {
  emoji: string;
  by: 'agent' | 'lead';
  at: string;
}

export interface ChatMessage {
  id: string;
  sender: MessageSender;
  type: MessageType;
  text?: string;
  audioDuration?: number;
  mediaUrl?: string;
  mediaBase64?: string;
  mimeType?: string;
  fileName?: string;
  timestamp: string;
  /** true quando o envio real via Meta Cloud API falhou — a mensagem ficou só local, o cliente nunca recebeu. */
  sendFailed?: boolean;
  /** id de outra mensagem desta conversa que esta responde (quote) — quando a mensagem citada tem id real de provedor, também chega no WhatsApp real do cliente (ver server/services/conversationStore.ts). */
  replyToMessageId?: string;
  /** id da mensagem original de onde esta foi encaminhada — metadado só do painel. */
  forwardedFromMessageId?: string;
  reactions?: MessageReaction[];
  /** Só presente quando sender='agent' — distingue resposta automática da IA de mensagem digitada manualmente por um operador no painel. */
  sentBy?: 'ai' | 'operator';
}

export interface ExtractedCRMData {
  budget?: string;
  timeline?: string;
  productsOfInterest?: string[];
  keyObjections?: string[];
  decisionCriteria?: string;
}

export interface FullConversationAnalysis {
  leadStage: string;
  dealProbability: number; // 0 to 100
  overallSentiment: 'Positivo' | 'Neutro' | 'Dúvida' | 'Urgente' | 'Objeção' | 'Frustrado' | string;
  urgencyLevel: number; // 1 to 5
  detectedLanguage?: string; // e.g. "Inglês (English)", "Espanhol (Spanish)", "Português"
  conversationSummary: string;
  extractedCRMData: ExtractedCRMData;
  keyTopicsDiscussed: string[];
  multiModalInsights: string[];
  /** Objetivo operacional conciso da próxima ação, apresentado como decisão para o atendente. */
  actionObjective?: string;
  /** Evidência da conversa que sustenta a ação recomendada. */
  actionRationale?: string;
  /** Limite que a resposta não pode ultrapassar sem uma confirmação real ou humana. */
  actionGuardrail?: string;
  recommendedNextAction: string;
  suggestedSmartReply: string;
  suggestedSmartReplyTranslation?: string; // Tradução/Explicação em Português para análise prévia do atendente
  lastUpdated?: string;
  source?: 'gemini' | 'fallback'; // 'fallback' = Gemini indisponível, resposta simulada
}

export interface LeadInfo {
  id: string;
  tenantId?: string;
  name: string;
  phone: string;
  avatarUrl?: string;
  timestamp: string;
  /** Só em leads reais (isReal): updatedAt cru do backend (ISO completo), pra ordenar por atividade de verdade — `timestamp` acima já vem formatado só como "HH:MM" pra exibição, e não dá pra reconstruir uma data válida a partir disso (ver bug real: lista real nunca ordenava, `new Date("14:32")` é Invalid Date). */
  updatedAtIso?: string;
  audioDuration?: number; // in seconds
  audioUrl?: string;
  audioBlob?: Blob;
  status: 'pending' | 'processing' | 'transcribed' | 'error';
  sampleType?: string;
  messages?: ChatMessage[];
  fullAnalysis?: FullConversationAnalysis;
  attribution?: LeadAttribution;
  // CRM Operator specific fields
  crmStage?: CRMStage;
  dealValue?: number;
  assignedOperator?: string;
  crmNotes?: CRMOperatorNote[];
  crmTasks?: CRMTask[];
  tags?: string[];
  /**
   * Etiquetas livres da conversa (tipo WhatsApp Business, ver
   * server/services/conversationLabelStore.ts) — diferente de `tags` acima,
   * que é do estágio único do CRM (OperatorCRM.tsx, ainda só localStorage).
   */
  conversationLabels?: string[];
  // Organização de conversas (arquivar, fixar, silenciar, não lida manual) —
  // metadados só do painel, ver server/services/conversationStore.ts.
  archivedAt?: string;
  pinnedAt?: string;
  muted?: boolean;
  manuallyUnread?: boolean;
  /** Lead não qualificado/insistente — IA para de responder só pra esse número (ver server/services/conversationStore.ts). */
  aiBlockedAt?: string;
  /** true = lead vindo do backend real (conversa de WhatsApp e/ou estado de CRM em server/services/crmStore.ts), nunca dado de exemplo local. Ações de CRM (App.tsx handleUpdateLead) persistem de verdade só quando true. */
  isReal?: boolean;
  /** true = existe conversa real de WhatsApp pra esse telefone (ver GET /api/crm/leads) — false quando o lead foi cadastrado manualmente no CRM e ainda não trocou mensagem nenhuma. */
  hasConversation?: boolean;
  email?: string;
}

export interface TranscriptionResult {
  transcription: string;
  language: string;
  summary: string;
  intent: string;
  sentiment: 'Positivo' | 'Neutro' | 'Dúvida' | 'Urgente' | 'Objeção' | 'Frustrado' | string;
  keyPoints: string[];
  suggestedReply: string;
  urgencyScore: number; // 1 to 5
  source?: 'gemini' | 'fallback'; // 'fallback' = Gemini indisponível, resposta simulada
}

export interface SavedTranscriptItem {
  id: string;
  title: string;
  source: 'microphone' | 'file_upload' | 'whatsapp_webhook';
  leadName?: string;
  leadPhone?: string;
  audioUrl?: string;
  audioDuration: number; // in seconds
  mimeType: string;
  createdAt: string;
  result: TranscriptionResult;
}

export interface WebhookConfig {
  webhookUrl: string;
  verifyToken: string;
  apiKey: string;
  autoReplyEnabled: boolean;
  minUrgencyForAlert: number;
}

/** Espelha ProviderTokenBreakdown (server/services/tokenUsageStore.ts). */
export interface ProviderTokenBreakdown {
  tokens: number;
  requests: number;
  costUSD: number;
}

/** Espelha ProviderBreakdown (server/services/tokenUsageStore.ts) — router fallback Groq: quanto do total veio de cada provedor. */
export interface ProviderBreakdown {
  gemini: ProviderTokenBreakdown;
  groq: ProviderTokenBreakdown;
}

/** Espelha TenantTokenSummary (server/services/tokenUsageStore.ts).
 * `estimatedCostUSD`/`cacheSavingsUSD`: calculados a partir do preço
 * confirmado do modelo em uso (server/services/modelPricing.ts) — sempre um
 * número, o backend nunca omite este campo (ver
 * server/routes/__tests__/telemetryShape.test.ts, que trava isso). Um
 * incidente real em produção (13/08/2026) veio do caminho oposto: este
 * campo existia só no frontend, sem o backend nunca enviá-lo —
 * `tRecord.estimatedCostUSD.toFixed(5)` lançava sobre `undefined` assim que
 * telemetria real chegava, sem Error Boundary pra conter o crash. */
export interface TenantTokenTelemetry {
  tenantId: string;
  tenantName: string;
  promptTokens: number;
  candidatesTokens: number;
  totalTokens: number;
  requestCount: number;
  cachedTokensSaved: number;
  estimatedCostUSD: number;
  cacheSavingsUSD: number;
  lastRequestAt: string;
  providerBreakdown: ProviderBreakdown;
}

export interface QueueSystemStatus {
  activeJobs: number;
  waitingJobs: number;
  completedJobs: number;
  failedJobs: number;
  rateLimitRPM: number;
}

/** Backlog técnico real do produto (aba "Roadmap Técnico & Backlog", server/services/roadmapStore.ts) — não é por tenant. */
export type RoadmapPriority = 'alta' | 'media' | 'baixa';
export type RoadmapStatus = 'pendente' | 'concluido';

export interface RoadmapItem {
  id: string;
  title: string;
  description: string;
  priority: RoadmapPriority;
  status: RoadmapStatus;
  imageBase64: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface BatchAnalysisJob {
  id: string;
  tenantId: string;
  totalItems: number;
  processedItems: number;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  tokensUsed: number;
  discountPercentage: number;
  createdAt: string;
  completedAt?: string;
}

/**
 * Escalonamento pra atendimento humano — "isso precisa de você" (ver
 * server/services/escalationStore.ts e GET/POST/DELETE /api/escalations em
 * server/routes/conversations.ts). Achado real em produção (issue #82, item
 * 2): esse backend existia e funcionava, mas não tinha NENHUMA UI — 17
 * escalonamentos acumulados no tenant real, 0 resolvidos, ninguém via.
 */
export interface EscalationInfo {
  id: string;
  phone: string;
  contactName?: string;
  reason: string;
  lastMessage?: string;
  country: string;
  resolved: boolean;
  createdAt: string;
  /** Orientação que o operador deixou pra IA usar ao retomar (issue #97). */
  operatorReply?: string;
  operatorReplyAt?: string;
  operatorReplyConsumedAt?: string;
  /** true = ainda dentro da janela de 24h da Meta (desde a última mensagem do lead) — só presente pra escalonamentos pendentes, ver GET /api/escalations. */
  withinServiceWindow?: boolean;
  serviceWindowExpiresAt?: string;
  /** 'payment_proof' = card mostra "Confirmar pagamento"/"Rejeitar pagamento" em vez das ações genéricas — verificação de pagamento unificada aqui (não mais um banner separado dentro da conversa). 'owner_review'/'customer_reply' = acompanhamento de funil (server/services/pendingFollowUpJob.ts) — mesmas ações genéricas do 'general'. */
  kind?: 'general' | 'payment_proof' | 'owner_review' | 'customer_reply';
}

export interface Operator {
  id?: string;
  name: string;
  email: string;
  role: 'operator' | 'admin' | 'saas_admin';
  tenantId: string;
}
