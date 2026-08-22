import { createHash } from 'crypto';
import { getDb } from './db';

export type AnalysisSource = 'groq' | 'gemini' | 'fallback';

export interface StoredConversationAnalysis<T = Record<string, unknown>> {
  id: string;
  tenantId: string;
  phone: string;
  contextHash: string;
  messageCount: number;
  source: AnalysisSource;
  model?: string;
  analysis: T;
  generatedAt: string;
  supersededAt?: string;
  createdBy?: string;
}

type AnalysisRow = {
  id: string;
  tenant_id: string;
  phone: string;
  context_hash: string;
  message_count: number;
  source: AnalysisSource;
  model: string | null;
  analysis: Record<string, unknown>;
  generated_at: string;
  superseded_at: string | null;
  created_by: string | null;
};

function toStored(row: AnalysisRow): StoredConversationAnalysis {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    phone: row.phone,
    contextHash: row.context_hash,
    messageCount: row.message_count,
    source: row.source,
    model: row.model || undefined,
    analysis: row.analysis,
    generatedAt: row.generated_at,
    supersededAt: row.superseded_at || undefined,
    createdBy: row.created_by || undefined,
  };
}

/** Hash de conteúdo, não de ordem de propriedades, para evitar reanálises desnecessárias do mesmo histórico. */
export function conversationContextHash(messages: unknown[], knowledgeBase?: unknown): string {
  const stable = JSON.stringify({ messages: messages || [], knowledgeBase: knowledgeBase || null });
  return createHash('sha256').update(stable).digest('hex');
}

export async function saveConversationAnalysis<T extends Record<string, unknown>>(
  tenantId: string,
  phone: string,
  messages: unknown[],
  knowledgeBase: unknown,
  analysis: T,
  source: AnalysisSource,
  options: { model?: string; actorId?: string } = {},
): Promise<StoredConversationAnalysis<T>> {
  const db = getDb();
  const contextHash = conversationContextHash(messages, knowledgeBase);
  const now = new Date().toISOString();
  // Marca versões anteriores como superseded apenas quando o contexto mudou.
  const { error: supersedeError } = await db.from('conversation_analyses')
    .update({ superseded_at: now })
    .eq('tenant_id', tenantId)
    .eq('phone', phone)
    .eq('superseded_at', null);
  if (supersedeError) throw supersedeError;

  const payload = {
    tenant_id: tenantId,
    phone,
    context_hash: contextHash,
    message_count: Array.isArray(messages) ? messages.length : 0,
    source,
    model: options.model || null,
    analysis,
    generated_at: now,
    superseded_at: null,
    created_by: options.actorId || null,
  };
  const { data, error } = await db.from('conversation_analyses')
    .upsert(payload, { onConflict: 'tenant_id,phone,context_hash' })
    .select('*')
    .maybeSingle();
  if (error) throw error;
  return toStored((data || payload) as AnalysisRow) as StoredConversationAnalysis<T>;
}

export async function getLatestConversationAnalysis<T extends Record<string, unknown>>(tenantId: string, phone: string): Promise<StoredConversationAnalysis<T> | undefined> {
  const { data, error } = await getDb().from('conversation_analyses').select('*').eq('tenant_id', tenantId).eq('phone', phone);
  if (error) throw error;
  const latest = ((data as AnalysisRow[]) || [])
    .filter((row) => !row.superseded_at)
    .sort((a, b) => b.generated_at.localeCompare(a.generated_at))[0];
  return latest ? toStored(latest) as StoredConversationAnalysis<T> : undefined;
}

export function freshnessFor(messageCount: number, stored?: StoredConversationAnalysis): { isFresh: boolean; newMessages: number } {
  if (!stored) return { isFresh: false, newMessages: Math.max(0, messageCount) };
  const newMessages = Math.max(0, messageCount - stored.messageCount);
  return { isFresh: newMessages === 0, newMessages };
}
