/**
 * Direção da PR3: cliente explícito, tenant-scoped pelo apiFetch e sem
 * fallback local. A versão vigente do agente continua no endpoint legado.
 */
import { apiFetch } from './apiClient';

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

export class KnowledgeBaseDocumentsApiError extends Error {
  constructor(message: string, public readonly status: number) {
    super(message);
    this.name = 'KnowledgeBaseDocumentsApiError';
  }
}

async function getResponseError(response: Response): Promise<KnowledgeBaseDocumentsApiError> {
  const payload = await response.json().catch(() => null) as { error?: unknown } | null;
  const message = typeof payload?.error === 'string' ? payload.error : `Falha ao comunicar com o servidor (HTTP ${response.status}).`;
  return new KnowledgeBaseDocumentsApiError(message, response.status);
}

export async function listKnowledgeBaseDocumentStates(): Promise<KnowledgeBaseDocumentState[]> {
  const response = await apiFetch('/api/knowledge-base/documents');
  if (!response.ok) throw await getResponseError(response);
  const payload = await response.json() as { documents?: KnowledgeBaseDocumentState[] };
  return payload.documents || [];
}

export async function saveKnowledgeBaseDocumentDraft(documentType: KnowledgeBaseDocumentType, data: Record<string, unknown>): Promise<KnowledgeBaseDocument> {
  const response = await apiFetch(`/api/knowledge-base/documents/${encodeURIComponent(documentType)}/draft`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ data }),
  });
  if (!response.ok) throw await getResponseError(response);
  const payload = await response.json() as { document: KnowledgeBaseDocument };
  return payload.document;
}

export async function publishKnowledgeBaseDocument(documentType: KnowledgeBaseDocumentType): Promise<KnowledgeBaseDocument> {
  const response = await apiFetch(`/api/knowledge-base/documents/${encodeURIComponent(documentType)}/publish`, { method: 'POST' });
  if (!response.ok) throw await getResponseError(response);
  const payload = await response.json() as { document: KnowledgeBaseDocument };
  return payload.document;
}

export async function listKnowledgeBaseDocumentEvents(documentType: KnowledgeBaseDocumentType): Promise<KnowledgeBaseDocumentEvent[]> {
  const response = await apiFetch(`/api/knowledge-base/documents/${encodeURIComponent(documentType)}/events`);
  if (!response.ok) throw await getResponseError(response);
  const payload = await response.json() as { events?: KnowledgeBaseDocumentEvent[] };
  return payload.events || [];
}
