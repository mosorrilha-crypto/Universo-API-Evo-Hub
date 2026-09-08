/**
 * Jornada do paciente/cliente: log append-only por contato (agendamentos +
 * mudanças de estágio do CRM), separado do estado atual (appointments/
 * crm_lead_state continuam sendo overwrite-only, intocados por esta tarefa).
 * Ver supabase/migrations/0080_contact_journey_history.sql pro raciocínio de
 * design (mesmo padrão de escalation_audit_events).
 *
 * Todo insert é melhor esforço: uma falha ao gravar aqui nunca pode derrubar
 * o caminho crítico de agendar/cancelar/mudar estágio — por isso os
 * `record*` desta store engolem erro (console.warn) em vez de propagar.
 */
import { getDb } from './db';

export type AppointmentJourneyEventType =
  | 'created'
  | 'rescheduled'
  | 'cancelled'
  | 'completed'
  | 'no_show'
  | 'payment_verified';

export type JourneyActor = 'ai' | 'operator' | 'system';

export interface RecordAppointmentJourneyEventInput {
  eventType: AppointmentJourneyEventType;
  serviceSummary?: string;
  scheduledStart?: string;
  scheduledEnd?: string;
  paymentStatus?: string;
  eventId?: string;
  actor?: JourneyActor;
  detail?: Record<string, unknown>;
}

export async function recordAppointmentJourneyEvent(tenantId: string, phone: string, input: RecordAppointmentJourneyEventInput): Promise<void> {
  try {
    const db = getDb();
    const { error } = await db.from('appointment_journey_events').insert({
      tenant_id: tenantId,
      phone,
      event_type: input.eventType,
      service_summary: input.serviceSummary ?? null,
      scheduled_start: input.scheduledStart ?? null,
      scheduled_end: input.scheduledEnd ?? null,
      payment_status: input.paymentStatus ?? null,
      event_id: input.eventId ?? null,
      actor: input.actor || 'system',
      detail: input.detail || {},
      created_at: new Date().toISOString(),
    });
    if (error) throw error;
  } catch (err) {
    console.warn('[contactJourneyStore] falha ao registrar evento de agendamento na jornada (não bloqueante):', err);
  }
}

export async function recordCrmStageChange(tenantId: string, phone: string, fromStage: string | undefined, toStage: string, changedBy?: string): Promise<void> {
  try {
    const db = getDb();
    const { error } = await db.from('crm_lead_stage_history').insert({
      tenant_id: tenantId,
      phone,
      from_stage: fromStage ?? null,
      to_stage: toStage,
      changed_by: changedBy ?? null,
      created_at: new Date().toISOString(),
    });
    if (error) throw error;
  } catch (err) {
    console.warn('[contactJourneyStore] falha ao registrar mudança de estágio na jornada (não bloqueante):', err);
  }
}

export type ContactJourneyEvent =
  | ({ kind: 'appointment' } & {
      id: string;
      eventType: AppointmentJourneyEventType;
      serviceSummary?: string;
      scheduledStart?: string;
      scheduledEnd?: string;
      paymentStatus?: string;
      eventId?: string;
      actor: JourneyActor;
      createdAt: string;
    })
  | ({ kind: 'stage_change' } & {
      id: string;
      fromStage?: string;
      toStage: string;
      changedBy?: string;
      createdAt: string;
    });

export interface ListContactJourneyOptions {
  limit?: number;
  beforeTimestamp?: string;
}

const DEFAULT_LIMIT = 30;
const MAX_LIMIT = 100;

/** Mescla os dois logs (agendamentos + estágio) por telefone, mais recente primeiro, com paginação simples por cursor de data. */
export async function listContactJourney(tenantId: string, phone: string, opts: ListContactJourneyOptions = {}): Promise<ContactJourneyEvent[]> {
  const limit = Math.min(Math.max(opts.limit || DEFAULT_LIMIT, 1), MAX_LIMIT);
  const db = getDb();

  let appointmentsQuery = db
    .from('appointment_journey_events')
    .select('*')
    .eq('tenant_id', tenantId)
    .eq('phone', phone)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (opts.beforeTimestamp) appointmentsQuery = appointmentsQuery.lt('created_at', opts.beforeTimestamp);

  let stageQuery = db
    .from('crm_lead_stage_history')
    .select('*')
    .eq('tenant_id', tenantId)
    .eq('phone', phone)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (opts.beforeTimestamp) stageQuery = stageQuery.lt('created_at', opts.beforeTimestamp);

  const [appointmentsResult, stageResult] = await Promise.all([appointmentsQuery, stageQuery]);
  if (appointmentsResult.error) throw appointmentsResult.error;
  if (stageResult.error) throw stageResult.error;

  const appointmentEvents: ContactJourneyEvent[] = (appointmentsResult.data || []).map((row: any) => ({
    kind: 'appointment' as const,
    id: row.id,
    eventType: row.event_type,
    serviceSummary: row.service_summary ?? undefined,
    scheduledStart: row.scheduled_start ?? undefined,
    scheduledEnd: row.scheduled_end ?? undefined,
    paymentStatus: row.payment_status ?? undefined,
    eventId: row.event_id ?? undefined,
    actor: row.actor,
    createdAt: row.created_at,
  }));

  const stageEvents: ContactJourneyEvent[] = (stageResult.data || []).map((row: any) => ({
    kind: 'stage_change' as const,
    id: row.id,
    fromStage: row.from_stage ?? undefined,
    toStage: row.to_stage,
    changedBy: row.changed_by ?? undefined,
    createdAt: row.created_at,
  }));

  return [...appointmentEvents, ...stageEvents].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)).slice(0, limit);
}
