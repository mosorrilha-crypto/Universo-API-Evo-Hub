/**
 * DTOs e Tipos Unificados para a Central de Operação por WhatsApp (Owner Operations Panel).
 * Compatíveis com os modelos existentes do Universo API Evo Hub.
 */

export type AgentRuntimeStatus = 'active' | 'paused' | 'restricted';
export type ConversationChannel = 'whatsapp' | 'instagram' | 'unknown';
export type MessageAuthor = 'contact' | 'agent' | 'operator' | 'system';
export type MessageKind = 'text' | 'audio' | 'image' | 'video' | 'document' | 'template' | 'event';
export type DeliveryStatus = 'pending' | 'sent' | 'delivered' | 'read' | 'failed';

export interface MetaTemplateVariable {
  index: number;
  label: string;
  exampleValue?: string;
  currentValue: string;
}

export interface ApprovedMetaTemplate {
  id: string;
  name: string;
  category: 'MARKETING' | 'UTILITY' | 'AUTHENTICATION';
  language: string;
  bodyText: string;
  headerText?: string;
  footerText?: string;
  variableExamples?: string[];
  estimatedCostUsd: number;
}

export interface ServiceWindowStatus {
  withinWindow: boolean;
  hoursRemaining: number;
  lastLeadMessageAt: string | null;
  windowExpiresAt: string | null;
}

export interface ContactProfileData {
  name: string;
  phone: string;
  avatarColor?: string;
  firstContactAt?: string;
  lastActivityAt?: string;
  interest?: string;
  hasBooked?: boolean;
  notes?: string;
  funnelStage?: {
    name: string;
    currentStep: number;
    totalSteps: number;
  };
  upcomingAppointments?: Array<{
    id: string;
    date: string;
    time: string;
    title: string;
    status: 'scheduled' | 'passed' | 'cancelled';
  }>;
}
