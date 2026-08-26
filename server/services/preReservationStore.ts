/**
 * Registro de pré-reserva (Agente Vertical, Etapa 1 — ver
 * docs/AGENTE-VERTICAL-ARQUITETURA.md, seção 4.1). O agente grava aqui
 * quando o cliente combina data/serviço na conversa, em vez de só
 * "prometer verbalmente" — vira uma tarefa real, visível pra qualquer
 * operador do tenant, não só quem atendeu.
 *
 * wa_message_id é a chave de idempotência: se o webhook da Meta reentregar
 * a mesma mensagem (retry por timeout), createPreReservation não duplica a
 * linha — devolve a existente.
 */
import { getDb, getPlatformDb } from './db';

export type PreReservationStatus = 'pending' | 'confirmed' | 'expired' | 'cancelled';

export interface PreReservation {
  id: string;
  phone: string;
  contactName?: string;
  serviceName: string;
  committedDate: string;
  status: PreReservationStatus;
  negotiationContext?: string;
  waMessageId: string;
  createdAt: string;
  updatedAt: string;
  /** Quando o operador foi alertado (Etapa 7 — job de follow-up) que a data combinada chegou e a pré-reserva ainda está pending. undefined = ainda não alertado. */
  followupAlertedAt?: string;
}

type PreReservationRow = {
  id: string;
  phone: string;
  contact_name: string | null;
  service_name: string;
  committed_date: string;
  status: PreReservationStatus;
  negotiation_context: string | null;
  wa_message_id: string;
  created_at: string;
  updated_at: string;
  followup_alerted_at: string | null;
};

function toPreReservation(row: PreReservationRow): PreReservation {
  return {
    id: row.id,
    phone: row.phone,
    contactName: row.contact_name || undefined,
    serviceName: row.service_name,
    committedDate: row.committed_date,
    status: row.status,
    negotiationContext: row.negotiation_context || undefined,
    waMessageId: row.wa_message_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    followupAlertedAt: row.followup_alerted_at || undefined,
  };
}

export interface CreatePreReservationInput {
  phone: string;
  contactName?: string;
  serviceName: string;
  committedDate: string;
  negotiationContext?: string;
  waMessageId: string;
}

/**
 * Cria a pré-reserva, ou devolve a existente se `waMessageId` já foi
 * processado antes (idempotência — nunca duplica por reentrega de webhook).
 */
export async function createPreReservation(tenantId: string, input: CreatePreReservationInput): Promise<PreReservation> {
  const db = getDb();
  const existing = await db
    .from('pre_reservations')
    .select('*')
    .eq('tenant_id', tenantId)
    .eq('wa_message_id', input.waMessageId)
    .maybeSingle();
  if (existing.data) return toPreReservation(existing.data as PreReservationRow);

  const { data, error } = await db
    .from('pre_reservations')
    .insert({
      tenant_id: tenantId,
      phone: input.phone,
      contact_name: input.contactName || null,
      service_name: input.serviceName,
      committed_date: input.committedDate,
      status: 'pending',
      negotiation_context: input.negotiationContext || null,
      wa_message_id: input.waMessageId,
    })
    .select('*')
    .single();
  if (error) throw error;
  return toPreReservation(data as PreReservationRow);
}

/** Todas as pré-reservas pendentes de um tenant — usado pelo job de follow-up (Etapa 7). */
export async function listPendingPreReservations(tenantId: string): Promise<PreReservation[]> {
  const db = getDb();
  const { data, error } = await db
    .from('pre_reservations')
    .select('*')
    .eq('tenant_id', tenantId)
    .eq('status', 'pending')
    .order('committed_date', { ascending: true });
  if (error) throw error;
  return (data as PreReservationRow[]).map(toPreReservation);
}

export async function updatePreReservationStatus(tenantId: string, id: string, status: PreReservationStatus): Promise<PreReservation | undefined> {
  const db = getDb();
  const { data, error } = await db
    .from('pre_reservations')
    .update({ status })
    .eq('tenant_id', tenantId)
    .eq('id', id)
    .select('*')
    .maybeSingle();
  if (error) throw error;
  return data ? toPreReservation(data as PreReservationRow) : undefined;
}

/** Marca que o operador já foi alertado sobre esta pré-reserva vencida (Etapa 7) — idempotência do job de follow-up, nunca duplica o alerta. */
export async function markFollowUpAlerted(tenantId: string, id: string): Promise<void> {
  const db = getDb();
  await db.from('pre_reservations').update({ followup_alerted_at: new Date().toISOString() }).eq('tenant_id', tenantId).eq('id', id);
}

/**
 * Todos os tenant_id distintos com ao menos uma pré-reserva pending — pré-
 * reserva não depende de Google Calendar conectado (diferente de lembretes
 * de agendamento, que precisam do evento real no Calendar), então o job de
 * follow-up itera por essa lista em vez de listConnectedCalendarTenants().
 */
export async function listTenantIdsWithPendingPreReservations(): Promise<string[]> {
  const db = getPlatformDb();
  const { data, error } = await db.from('pre_reservations').select('tenant_id').eq('status', 'pending');
  if (error) throw error;
  const ids = new Set(((data || []) as { tenant_id: string }[]).map((row) => row.tenant_id));
  return Array.from(ids);
}
