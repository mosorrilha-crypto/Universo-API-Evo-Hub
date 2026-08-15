export type ActiveTab = 'whatsapp' | 'crm' | 'financial' | 'saas' | 'attribution' | 'knowledge' | 'integration' | 'evohub' | 'escalations';

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

export type PaymentMethod = 'PIX' | 'Cartão de Crédito' | 'Boleto Bancário' | 'Link WhatsApp';
export type PaymentStatus = 'pago' | 'pendente' | 'atrasado' | 'cancelado';

export interface FinancialTransaction {
  id: string;
  tenantId?: string;
  leadId: string;
  leadName: string;
  leadPhone: string;
  productName: string;
  amount: number; // in BRL
  paymentMethod: PaymentMethod;
  status: PaymentStatus;
  date: string;
  operatorName: string;
  channel: string;
  pixQrCode?: string;
  paymentLinkUrl?: string;
  /** true quando veio de GET /api/financial/transactions (registro real persistido no servidor) — distingue de dado de demonstração local, mesmo papel que LeadInfo.isReal. */
  isReal?: boolean;
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

export interface AgentProduct {
  id: string;
  name: string;
  price: string;
  description: string;
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
  /** id de outra mensagem desta conversa que esta responde (quote) — metadado só do painel, não reflete no WhatsApp real. */
  replyToMessageId?: string;
  /** id da mensagem original de onde esta foi encaminhada — metadado só do painel. */
  forwardedFromMessageId?: string;
  /** presente quando o texto foi editado depois de enviado. */
  editedAt?: string;
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

/** Espelha TenantTokenSummary (server/services/tokenUsageStore.ts) — sem
 * `estimatedCostUSD`: não existe uma constante confiável de preço por token
 * pro modelo em uso, e o backend nunca calculou isso por tenant. Esse campo
 * chegou a existir aqui e causou uma tela branca real em produção
 * (13/08/2026) — `tRecord.estimatedCostUSD.toFixed(5)` lançando sobre
 * `undefined` assim que telemetria real (não mais vazia) chegava do
 * backend, sem Error Boundary pra conter o crash. */
export interface TenantTokenTelemetry {
  tenantId: string;
  tenantName: string;
  promptTokens: number;
  candidatesTokens: number;
  totalTokens: number;
  requestCount: number;
  cachedTokensSaved: number;
  lastRequestAt: string;
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
  /** 'payment_proof' = card mostra "Confirmar pagamento"/"Rejeitar pagamento" em vez das ações genéricas — verificação de pagamento unificada aqui (não mais um banner separado dentro da conversa). */
  kind?: 'general' | 'payment_proof';
}

export interface Operator {
  id?: string;
  name: string;
  email: string;
  role: 'operator' | 'admin' | 'saas_admin';
  tenantId: string;
}

