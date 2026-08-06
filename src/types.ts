export type ActiveTab = 'whatsapp' | 'crm' | 'financial' | 'saas' | 'attribution' | 'knowledge' | 'integration' | 'evohub';

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
  promoPrice?: string;
  promoUntil?: string;
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
  uploadDate: string;
  status: 'Processado' | 'Pendente';
}

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
  lastSaved?: string;
}

export type MessageSender = 'lead' | 'agent' | 'system';
export type MessageType = 'text' | 'audio' | 'image' | 'file';

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

export interface TenantTokenTelemetry {
  tenantId: string;
  tenantName: string;
  promptTokens: number;
  candidatesTokens: number;
  totalTokens: number;
  requestCount: number;
  estimatedCostUSD: number;
  cachedTokensSaved: number;
  lastRequestAt: string;
}

export interface QueueSystemStatus {
  activeJobs: number;
  waitingJobs: number;
  completedJobs: number;
  failedJobs: number;
  rateLimitRPM: number;
  mockModeEnabled: boolean;
  contextCacheEnabled: boolean;
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

export interface Operator {
  id?: string;
  name: string;
  email: string;
  role: 'operator' | 'admin' | 'saas_admin';
  tenantId: string;
}

