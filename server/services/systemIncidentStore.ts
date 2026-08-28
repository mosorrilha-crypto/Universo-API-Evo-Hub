import { getDb } from './db';

export type SystemIncidentCategory = 'runtime' | 'knowledge_base' | 'authentication' | 'catalog' | 'media' | 'integration' | 'availability';
export type SystemIncidentSeverity = 'critical' | 'high' | 'medium' | 'low';
export type SystemIncidentStatus = 'open' | 'reviewed' | 'resolved' | 'archived';

export interface SystemIncident {
  id: string;
  tenantId: string;
  sourceKey: string;
  category: SystemIncidentCategory;
  severity: SystemIncidentSeverity;
  status: SystemIncidentStatus;
  title: string;
  detail: string;
  suggestedAction: string;
  metadata: Record<string, unknown>;
  occurrenceCount: number;
  firstSeenAt: string;
  lastSeenAt: string;
  reviewedAt?: string;
  reviewedBy?: string;
  resolvedAt?: string;
  resolvedBy?: string;
  resolutionNote?: string;
}

export interface SystemIncidentActor { id?: string; }

export interface ReportSystemIncidentInput {
  tenantId: string;
  sourceKey: string;
  category: SystemIncidentCategory;
  severity: SystemIncidentSeverity;
  title: string;
  detail?: string;
  suggestedAction: string;
  metadata?: Record<string, unknown>;
}

type SystemIncidentRow = {
  id: string; tenant_id: string; source_key: string; category: SystemIncidentCategory; severity: SystemIncidentSeverity; status: SystemIncidentStatus;
  title: string; detail: string; suggested_action: string; metadata: Record<string, unknown>; occurrence_count: number;
  first_seen_at: string; last_seen_at: string; reviewed_at: string | null; reviewed_by: string | null;
  resolved_at: string | null; resolved_by: string | null; resolution_note: string | null;
};

const MAX_DETAIL_LENGTH = 600;
const MAX_TITLE_LENGTH = 160;
const MAX_SUGGESTION_LENGTH = 500;

function text(value: string | undefined, max: number): string {
  return String(value || '').replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

function toIncident(row: SystemIncidentRow): SystemIncident {
  return {
    id: row.id, tenantId: row.tenant_id, sourceKey: row.source_key, category: row.category, severity: row.severity, status: row.status,
    title: row.title, detail: row.detail, suggestedAction: row.suggested_action, metadata: row.metadata || {}, occurrenceCount: row.occurrence_count,
    firstSeenAt: row.first_seen_at, lastSeenAt: row.last_seen_at, reviewedAt: row.reviewed_at || undefined, reviewedBy: row.reviewed_by || undefined,
    resolvedAt: row.resolved_at || undefined, resolvedBy: row.resolved_by || undefined, resolutionNote: row.resolution_note || undefined,
  };
}

async function appendAuditEvent(tenantId: string, incidentId: string, eventType: 'created' | 'recurred' | 'reviewed' | 'resolved' | 'archived' | 'restored', actor?: SystemIncidentActor, detail: Record<string, unknown> = {}): Promise<void> {
  const { error } = await getDb().from('system_incident_audit_events').insert({
    tenant_id: tenantId, incident_id: incidentId, actor_id: actor?.id || null, event_type: eventType, detail,
  });
  if (error) throw error;
}

/** Registra uma ocorrência sem notificar ninguém. O mesmo sinal aberto é agrupado por tenant + sourceKey. */
export async function reportSystemIncident(input: ReportSystemIncidentInput): Promise<SystemIncident> {
  const db = getDb();
  const now = new Date().toISOString();
  const safeTitle = text(input.title, MAX_TITLE_LENGTH) || 'Incidente técnico sem título';
  const safeDetail = text(input.detail, MAX_DETAIL_LENGTH);
  const safeSuggestion = text(input.suggestedAction, MAX_SUGGESTION_LENGTH) || 'Revise o incidente antes de tomar qualquer ação.';
  const { data: activeRows, error: findError } = await db.from('system_incidents').select('*')
    .eq('tenant_id', input.tenantId).eq('source_key', input.sourceKey).in('status', ['open', 'reviewed']).limit(1);
  if (findError) throw findError;
  const existing = (activeRows?.[0] || null) as SystemIncidentRow | null;
  if (existing) {
    const { data, error } = await db.from('system_incidents').update({
      severity: input.severity, title: safeTitle, detail: safeDetail, suggested_action: safeSuggestion, metadata: input.metadata || {},
      occurrence_count: Number(existing.occurrence_count || 1) + 1, last_seen_at: now,
    }).eq('tenant_id', input.tenantId).eq('id', existing.id).select('*').single();
    if (error) throw error;
    const incident = toIncident(data as SystemIncidentRow);
    await appendAuditEvent(input.tenantId, incident.id, 'recurred', undefined, { occurrenceCount: incident.occurrenceCount });
    return incident;
  }
  const { data, error } = await db.from('system_incidents').insert({
    tenant_id: input.tenantId, source_key: input.sourceKey, category: input.category, severity: input.severity,
    status: 'open', title: safeTitle, detail: safeDetail, suggested_action: safeSuggestion, metadata: input.metadata || {}, occurrence_count: 1,
    first_seen_at: now, last_seen_at: now,
  }).select('*').single();
  if (error) throw error;
  const incident = toIncident(data as SystemIncidentRow);
  await appendAuditEvent(input.tenantId, incident.id, 'created');
  return incident;
}

export async function listSystemIncidents(tenantId: string, options: { status?: SystemIncidentStatus; limit?: number } = {}): Promise<SystemIncident[]> {
  const limit = Math.max(1, Math.min(options.limit ?? 200, 500));
  let query = getDb().from('system_incidents').select('*').eq('tenant_id', tenantId).order('last_seen_at', { ascending: false }).limit(limit);
  if (options.status) query = query.eq('status', options.status);
  const { data, error } = await query;
  if (error) throw error;
  return ((data || []) as SystemIncidentRow[]).map(toIncident);
}

async function transitionSystemIncident(tenantId: string, incidentId: string, status: SystemIncidentStatus, eventType: 'reviewed' | 'resolved' | 'archived' | 'restored', actor?: SystemIncidentActor, resolutionNote?: string): Promise<SystemIncident | null> {
  const now = new Date().toISOString();
  const update: Record<string, unknown> = { status };
  if (status === 'reviewed') { update.reviewed_at = now; update.reviewed_by = actor?.id || null; }
  if (status === 'resolved') { update.resolved_at = now; update.resolved_by = actor?.id || null; update.resolution_note = text(resolutionNote, MAX_DETAIL_LENGTH); }
  if (status === 'open') { update.resolved_at = null; update.resolved_by = null; update.resolution_note = null; }
  const { data, error } = await getDb().from('system_incidents').update(update).eq('tenant_id', tenantId).eq('id', incidentId).select('*').maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const incident = toIncident(data as SystemIncidentRow);
  await appendAuditEvent(tenantId, incident.id, eventType, actor, resolutionNote ? { resolutionNote: text(resolutionNote, MAX_DETAIL_LENGTH) } : {});
  return incident;
}

export const reviewSystemIncident = (tenantId: string, incidentId: string, actor?: SystemIncidentActor) => transitionSystemIncident(tenantId, incidentId, 'reviewed', 'reviewed', actor);
export const resolveSystemIncident = (tenantId: string, incidentId: string, actor?: SystemIncidentActor, resolutionNote?: string) => transitionSystemIncident(tenantId, incidentId, 'resolved', 'resolved', actor, resolutionNote);
export const archiveSystemIncident = (tenantId: string, incidentId: string, actor?: SystemIncidentActor) => transitionSystemIncident(tenantId, incidentId, 'archived', 'archived', actor);
export const restoreSystemIncident = (tenantId: string, incidentId: string, actor?: SystemIncidentActor) => transitionSystemIncident(tenantId, incidentId, 'open', 'restored', actor);
