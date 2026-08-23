import { randomUUID } from 'crypto';
import { getDb } from './db';

export type OperationEventType =
  | 'ai_reply_status'
  | 'escalation_created'
  | 'escalation_assigned'
  | 'escalation_resolved'
  | 'escalation_archived'
  | 'conversation_analysis_saved';

export interface OperationEvent {
  id: string;
  tenant_id: string;
  phone?: string | null;
  escalation_id?: string | null;
  event_type: OperationEventType | string;
  payload: Record<string, unknown>;
  created_at: string;
}

function normalizePayload(payload: unknown): Record<string, unknown> {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return {};
  return payload as Record<string, unknown>;
}

/**
 * Persiste marcos operacionais mínimos. A escrita é deliberadamente separada
 * do fluxo de atendimento: falha de telemetria não pode bloquear uma conversa
 * nem converter um evento transitório em uma falha de entrega ao cliente.
 */
export async function recordOperationEvent(input: {
  tenantId: string;
  eventType: OperationEventType | string;
  phone?: string | null;
  escalationId?: string | null;
  payload?: Record<string, unknown>;
}): Promise<OperationEvent> {
  const db = getDb();
  const { data, error } = await db
    .from('operation_events')
    .insert({
      id: randomUUID(),
      tenant_id: input.tenantId,
      phone: input.phone ?? null,
      escalation_id: input.escalationId ?? null,
      event_type: input.eventType,
      payload: normalizePayload(input.payload),
    })
    .select('*')
    .single();
  if (error) throw error;
  return data as OperationEvent;
}

export async function listOperationEvents(
  tenantId: string,
  options: { phone?: string; limit?: number } = {},
): Promise<OperationEvent[]> {
  const db = getDb();
  let query = db
    .from('operation_events')
    .select('*')
    .eq('tenant_id', tenantId)
    .order('created_at', { ascending: false });
  if (options.phone) query = query.eq('phone', options.phone);
  const { data, error } = await query;
  if (error) throw error;
  return ((data || []) as OperationEvent[]).slice(0, Math.max(1, Math.min(options.limit ?? 200, 500)));
}
