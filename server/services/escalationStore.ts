import { createHash } from 'crypto';
import { getDb } from './db';
import { inferCountryFromPhone } from './conversationStore';
import { notifyEscalationCreated } from './escalationAlertService';
import { recordOperationEvent } from './operationEventStore';

export type EscalationKind = 'general' | 'payment_proof' | 'owner_review' | 'customer_reply';
export type EscalationPriority = 'critical' | 'high' | 'medium' | 'low';
export type EscalationStatus = 'open' | 'assigned' | 'awaiting_customer' | 'resolved' | 'archived';

export interface Escalation {
  id: string;
  phone: string;
  contactName?: string;
  reason: string;
  lastMessage?: string;
  country: string;
  /** Compatibilidade transitória com os consumidores atuais. */
  resolved: boolean;
  createdAt: string;
  kind: EscalationKind;
  status: EscalationStatus;
  priority: EscalationPriority;
  dueAt?: string;
  assignedOperatorId?: string;
  assignedAt?: string;
  resolvedAt?: string;
  resolvedBy?: string;
  resolutionCode?: string;
  resolutionNote?: string;
  sourceKey: string;
  occurrenceCount: number;
  operatorReply?: string;
  operatorReplyAt?: string;
  operatorReplyConsumedAt?: string;
  guidanceExpiresAt?: string;
  guidanceContextHash?: string;
  lastAlertAttemptAt?: string;
  lastAlertStatus?: string;
  deletedAt?: string;
}

export interface EscalationActor {
  id?: string;
  name?: string;
}

export interface LogEscalationOptions {
  sourceKey?: string;
  priority?: EscalationPriority;
  dueAt?: string;
  actor?: EscalationActor;
  guidanceContextHash?: string;
}

export interface ResolveEscalationOptions {
  actor?: EscalationActor;
  resolutionCode?: string;
  resolutionNote?: string;
}

type EscalationRow = {
  id: string;
  tenant_id: string;
  phone: string;
  contact_name: string | null;
  reason: string;
  last_message: string | null;
  country: string | null;
  resolved: boolean;
  created_at: string;
  operator_reply: string | null;
  operator_reply_at: string | null;
  operator_reply_consumed_at: string | null;
  kind: EscalationKind | null;
  status?: EscalationStatus | null;
  priority?: EscalationPriority | null;
  due_at?: string | null;
  assigned_operator_id?: string | null;
  assigned_at?: string | null;
  resolved_at?: string | null;
  resolved_by?: string | null;
  resolution_code?: string | null;
  resolution_note?: string | null;
  source_key?: string | null;
  occurrence_count?: number | null;
  guidance_expires_at?: string | null;
  guidance_context_hash?: string | null;
  last_alert_attempt_at?: string | null;
  last_alert_status?: string | null;
  deleted_at?: string | null;
};

function toEscalation(row: EscalationRow): Escalation {
  const status = row.status || (row.resolved ? 'resolved' : 'open');
  return {
    id: row.id,
    phone: row.phone,
    contactName: row.contact_name || undefined,
    reason: row.reason,
    lastMessage: row.last_message || undefined,
    country: row.country || 'Desconhecido',
    resolved: row.resolved || status === 'resolved',
    createdAt: row.created_at,
    kind: row.kind || 'general',
    status,
    priority: row.priority || 'medium',
    dueAt: row.due_at || undefined,
    assignedOperatorId: row.assigned_operator_id || undefined,
    assignedAt: row.assigned_at || undefined,
    resolvedAt: row.resolved_at || undefined,
    resolvedBy: row.resolved_by || undefined,
    resolutionCode: row.resolution_code || undefined,
    resolutionNote: row.resolution_note || undefined,
    sourceKey: row.source_key || `legacy:${row.id}`,
    occurrenceCount: row.occurrence_count || 1,
    operatorReply: row.operator_reply || undefined,
    operatorReplyAt: row.operator_reply_at || undefined,
    operatorReplyConsumedAt: row.operator_reply_consumed_at || undefined,
    guidanceExpiresAt: row.guidance_expires_at || undefined,
    guidanceContextHash: row.guidance_context_hash || undefined,
    lastAlertAttemptAt: row.last_alert_attempt_at || undefined,
    lastAlertStatus: row.last_alert_status || undefined,
    deletedAt: row.deleted_at || undefined,
  };
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 32);
}

function normalizeForKey(value?: string): string {
  return String(value || '').trim().replace(/\s+/g, ' ').toLowerCase();
}

function defaultSourceKey(phone: string, kind: EscalationKind, reason: string, lastMessage?: string): string {
  return `${kind}:${phone}:${sha256(`${normalizeForKey(reason)}|${normalizeForKey(lastMessage)}`)}`;
}

function defaultPriority(kind: EscalationKind, reason: string): EscalationPriority {
  const text = normalizeForKey(reason);
  if (kind === 'payment_proof' || /reclamacao|reclamação|fraude|bloquead/.test(text)) return 'high';
  if (kind === 'owner_review') return 'high';
  if (kind === 'customer_reply') return 'medium';
  if (/falha ao responder|revisor pre envio|revisor pré envio/.test(text)) return 'high';
  return 'medium';
}

function defaultDueAt(priority: EscalationPriority, now = Date.now()): string {
  const delayMs: Record<EscalationPriority, number> = {
    critical: 15 * 60 * 1000,
    high: 60 * 60 * 1000,
    medium: 4 * 60 * 60 * 1000,
    low: 24 * 60 * 60 * 1000,
  };
  return new Date(now + delayMs[priority]).toISOString();
}

async function appendAuditEvent(tenantId: string, escalationId: string, eventType: string, detail: Record<string, unknown> = {}, actor?: EscalationActor): Promise<void> {
  const { error } = await getDb().from('escalation_audit_events').insert({
    tenant_id: tenantId,
    escalation_id: escalationId,
    actor_id: actor?.id || null,
    event_type: eventType,
    detail: { ...detail, actorName: actor?.name || null },
    created_at: new Date().toISOString(),
  });
  if (error) throw error;
}

function recordEscalationOperation(tenantId: string, escalation: Escalation, eventType: string, payload: Record<string, unknown> = {}): void {
  void recordOperationEvent({
    tenantId,
    phone: escalation.phone,
    escalationId: escalation.id,
    eventType,
    payload,
  }).catch((error) => console.warn(`⚠️ [Observabilidade] Falha ao persistir ${eventType} do escalonamento ${escalation.id}:`, error?.message || error));
}

async function updateAlertStatus(tenantId: string, id: string, status: 'sent' | 'failed'): Promise<void> {
  const { error } = await getDb().from('escalations')
    .update({ last_alert_attempt_at: new Date().toISOString(), last_alert_status: status })
    .eq('tenant_id', tenantId)
    .eq('id', id);
  if (error) throw error;
  await appendAuditEvent(tenantId, id, `alert_${status}`);
}

/** Pagamentos exigem decisão humana; termos fortes de assédio também são escalados. */
export function isPaymentRelated(text: string): boolean {
  return /\b(pago|pagu[eé]i|se[ñn]a|transfer[êe]nc[ií]a|transferir|comprobante|comprovante|dep[oó]sit(o|ei))\b/i.test(text || '');
}

export function looksLikeHarassment(text: string): boolean {
  return /(te quiero mucho|te amo\b|me enamor[eé]|eres hermosa|quiero conocerte en persona|tienes novia|tienes novio|est[aá]s soltera|c[aá]sate conmigo|c[aá]sese conmigo|m[aá]ndame una foto tuya|una foto tuya real|b[eé]same|te extra[ñn]o mi amor)/i.test(text || '');
}

/**
 * Cria ou reabre um único caso por fonte. O `sourceKey` estabiliza a
 * deduplicação para o mesmo evento; recorrências atualizam o contador e a
 * trilha de auditoria em vez de inundar a fila com cartões iguais.
 */
export async function logEscalation(
  tenantId: string,
  phone: string,
  contactName: string | undefined,
  reason: string,
  lastMessage?: string,
  kind: EscalationKind = 'general',
  options: LogEscalationOptions = {},
): Promise<Escalation> {
  const db = getDb();
  const sourceKey = options.sourceKey || defaultSourceKey(phone, kind, reason, lastMessage);
  const priority = options.priority || defaultPriority(kind, reason);
  const now = new Date().toISOString();
  const { data: existingData, error: existingError } = await db.from('escalations')
    .select('*').eq('tenant_id', tenantId).eq('source_key', sourceKey);
  if (existingError) throw existingError;
  const existing = ((existingData as EscalationRow[]) || []).find((row) => !row.deleted_at);

  if (existing) {
    const wasResolved = existing.resolved || existing.status === 'resolved' || existing.status === 'archived';
    const update = {
      contact_name: contactName || existing.contact_name,
      reason,
      last_message: lastMessage || existing.last_message,
      priority,
      due_at: options.dueAt || (wasResolved ? defaultDueAt(priority) : existing.due_at || defaultDueAt(priority)),
      status: wasResolved ? 'open' as EscalationStatus : existing.status || 'open',
      resolved: false,
      resolved_at: wasResolved ? null : existing.resolved_at || null,
      resolved_by: wasResolved ? null : existing.resolved_by || null,
      resolution_code: wasResolved ? null : existing.resolution_code || null,
      resolution_note: wasResolved ? null : existing.resolution_note || null,
      deleted_at: null,
      occurrence_count: Number(existing.occurrence_count || 1) + 1,
    };
    const { data, error } = await db.from('escalations').update(update).eq('tenant_id', tenantId).eq('id', existing.id).select('*').maybeSingle();
    if (error) throw error;
    const escalation = toEscalation(data as EscalationRow);
    await appendAuditEvent(tenantId, escalation.id, wasResolved ? 'reopened' : 'reoccurred', { sourceKey, occurrenceCount: escalation.occurrenceCount, reason }, options.actor);
    recordEscalationOperation(tenantId, escalation, 'escalation_created', { outcome: wasResolved ? 'reopened' : 'reoccurred', occurrenceCount: escalation.occurrenceCount, priority: escalation.priority });
    return escalation;
  }

  const id = `esc-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const row = {
    id,
    tenant_id: tenantId,
    phone,
    contact_name: contactName || null,
    reason,
    last_message: lastMessage || null,
    country: inferCountryFromPhone(phone),
    resolved: false,
    created_at: now,
    kind,
    status: 'open' as EscalationStatus,
    priority,
    due_at: options.dueAt || defaultDueAt(priority),
    source_key: sourceKey,
    occurrence_count: 1,
    guidance_context_hash: options.guidanceContextHash || null,
    operator_reply: null,
    operator_reply_at: null,
    operator_reply_consumed_at: null,
  };
  const { data, error } = await db.from('escalations').insert(row).select('*').maybeSingle();
  if (error) throw error;
  const escalation = toEscalation((data || row) as EscalationRow);
  await appendAuditEvent(tenantId, escalation.id, 'created', { sourceKey, priority, dueAt: escalation.dueAt, kind, reason }, options.actor);
  recordEscalationOperation(tenantId, escalation, 'escalation_created', { priority, dueAt: escalation.dueAt, kind });
  console.log(`🚨 [Escalonamento] tenant=${tenantId} ${phone} (${row.country}) [${priority}]: ${reason}`);
  // Alerta é observável, mas nunca impede a criação do caso de negócio.
  notifyEscalationCreated(tenantId, { phone, contactName, reason })
    .then(() => updateAlertStatus(tenantId, escalation.id, 'sent'))
    .catch(async (err) => {
      console.warn(`⚠️ [Alerta de escalonamento] tenant=${tenantId} falha ao notificar:`, (err as Error).message);
      await updateAlertStatus(tenantId, escalation.id, 'failed').catch(() => undefined);
    });
  return escalation;
}

function priorityRank(priority: EscalationPriority): number {
  return ({ critical: 0, high: 1, medium: 2, low: 3 } as const)[priority];
}

function statusRank(status: EscalationStatus): number {
  return ({ open: 0, assigned: 1, awaiting_customer: 2, resolved: 3, archived: 4 } as const)[status];
}

export async function listEscalations(tenantId: string): Promise<Escalation[]> {
  const { data, error } = await getDb().from('escalations').select('*').eq('tenant_id', tenantId);
  if (error) throw error;
  return ((data as EscalationRow[]) || [])
    .map(toEscalation)
    .filter((item) => !item.deletedAt)
    .sort((a, b) => {
      const statusDelta = statusRank(a.status) - statusRank(b.status);
      if (statusDelta) return statusDelta;
      const priorityDelta = priorityRank(a.priority) - priorityRank(b.priority);
      if (priorityDelta) return priorityDelta;
      const dueDelta = (a.dueAt || '9999').localeCompare(b.dueAt || '9999');
      if (dueDelta) return dueDelta;
      return b.createdAt.localeCompare(a.createdAt);
    });
}

/** Escalonamento em aberto mais recente para um contato específico, sem consultar dados de outros contatos/tenants. */
export async function getOpenEscalationForPhone(tenantId: string, phone: string): Promise<Escalation | undefined> {
  const db = getDb();
  const { data, error } = await db
    .from('escalations')
    .select('*')
    .eq('tenant_id', tenantId)
    .eq('phone', phone)
    .eq('resolved', false)
    .order('created_at', { ascending: false });
  if (error) throw error;
  const latest = ((data as EscalationRow[]) || [])
    .filter((row) => !row.deleted_at)
    .sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
  return latest ? toEscalation(latest) : undefined;
}

export async function assignEscalation(tenantId: string, id: string, operatorId: string | null, actor?: EscalationActor): Promise<Escalation | undefined> {
  const update = operatorId
    ? { assigned_operator_id: operatorId, assigned_at: new Date().toISOString(), status: 'assigned' as EscalationStatus }
    : { assigned_operator_id: null, assigned_at: null, status: 'open' as EscalationStatus };
  const { data, error } = await getDb().from('escalations').update(update).eq('tenant_id', tenantId).eq('id', id).select('*').maybeSingle();
  if (error) throw error;
  if (!data) return undefined;
  const escalation = toEscalation(data as EscalationRow);
  await appendAuditEvent(tenantId, id, operatorId ? 'assigned' : 'unassigned', { assignedOperatorId: operatorId }, actor);
  recordEscalationOperation(tenantId, escalation, 'escalation_assigned', { assignedOperatorId: operatorId, outcome: operatorId ? 'assigned' : 'unassigned' });
  return escalation;
}

export async function resolveEscalation(tenantId: string, id: string, options: ResolveEscalationOptions = {}): Promise<Escalation | undefined> {
  const now = new Date().toISOString();
  const { data, error } = await getDb().from('escalations').update({
    resolved: true,
    status: 'resolved' as EscalationStatus,
    resolved_at: now,
    resolved_by: options.actor?.id || null,
    resolution_code: options.resolutionCode || 'manual_resolve',
    resolution_note: options.resolutionNote || null,
  }).eq('tenant_id', tenantId).eq('id', id).select('*').maybeSingle();
  if (error) throw error;
  if (!data) return undefined;
  await appendAuditEvent(tenantId, id, 'resolved', { code: options.resolutionCode || 'manual_resolve', note: options.resolutionNote || null }, options.actor);
  const escalation = toEscalation(data as EscalationRow);
  recordEscalationOperation(tenantId, escalation, 'escalation_resolved', { code: options.resolutionCode || 'manual_resolve' });
  return escalation;
}

/** Arquiva sem apagar: a história fica disponível para auditoria e métricas. */
export async function deleteEscalation(tenantId: string, id: string, actor?: EscalationActor): Promise<boolean> {
  const { data, error } = await getDb().from('escalations').update({
    status: 'archived' as EscalationStatus,
    deleted_at: new Date().toISOString(),
  }).eq('tenant_id', tenantId).eq('id', id).select('*');
  if (error) throw error;
  if (!data?.length) return false;
  const escalation = toEscalation(data[0] as EscalationRow);
  await appendAuditEvent(tenantId, id, 'archived', {}, actor);
  recordEscalationOperation(tenantId, escalation, 'escalation_archived');
  return true;
}

/** A orientação humana expira após 48h e fica ligada ao contexto que a originou. */
export async function submitOperatorReply(tenantId: string, id: string, reply: string, actor?: EscalationActor, contextHash?: string): Promise<Escalation | undefined> {
  const now = new Date();
  const { data, error } = await getDb().from('escalations').update({
    operator_reply: reply,
    operator_reply_at: now.toISOString(),
    operator_reply_consumed_at: null,
    guidance_expires_at: new Date(now.getTime() + 48 * 60 * 60 * 1000).toISOString(),
    guidance_context_hash: contextHash || sha256(normalizeForKey(reply)),
    status: 'awaiting_customer' as EscalationStatus,
  }).eq('tenant_id', tenantId).eq('id', id).select('*').maybeSingle();
  if (error) throw error;
  if (!data) return undefined;
  const escalation = toEscalation(data as EscalationRow);
  await appendAuditEvent(tenantId, id, 'guidance_submitted', { expiresAt: escalation.guidanceExpiresAt }, actor);
  return escalation;
}

export async function getPendingOperatorGuidance(tenantId: string, phone: string): Promise<Escalation | undefined> {
  const { data, error } = await getDb().from('escalations').select('*').eq('tenant_id', tenantId).eq('phone', phone).eq('resolved', false);
  if (error) throw error;
  const now = new Date().toISOString();
  const pending = ((data as EscalationRow[]) || [])
    .filter((row) => row.operator_reply && !row.operator_reply_consumed_at && !row.deleted_at)
    .filter((row) => !row.guidance_expires_at || row.guidance_expires_at > now)
    .sort((a, b) => (b.operator_reply_at || '').localeCompare(a.operator_reply_at || ''));
  return pending[0] ? toEscalation(pending[0]) : undefined;
}

/** Marca a orientação como consumida e fecha o caso com a decisão rastreável. */
export async function markOperatorGuidanceConsumed(tenantId: string, id: string): Promise<void> {
  const now = new Date().toISOString();
  const { error } = await getDb().from('escalations').update({
    operator_reply_consumed_at: now,
    resolved: true,
    status: 'resolved' as EscalationStatus,
    resolved_at: now,
    resolution_code: 'guidance_consumed',
  }).eq('tenant_id', tenantId).eq('id', id);
  if (error) throw error;
  await appendAuditEvent(tenantId, id, 'guidance_consumed', {});
}
