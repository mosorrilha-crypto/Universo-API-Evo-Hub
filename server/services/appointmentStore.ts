/**
 * Rastreia o agendamento ATIVO (evento do Google Calendar) de cada número de
 * telefone — necessário pra remarcar/cancelar sem depender do modelo
 * "lembrar" ou inventar um eventId. Migrado pra tabela Postgres
 * `appointments` (Bloco 2.A), chave (tenant_id, phone).
 */
import { getDb } from './db';

export interface TrackedAppointment {
  eventId: string;
  summary: string;
  startIso: string;
  endIso: string;
  createdAt: string;
}

type AppointmentRow = {
  phone: string;
  event_id: string;
  summary: string;
  start_iso: string;
  end_iso: string;
  created_at: string;
};

function toTracked(row: AppointmentRow): TrackedAppointment {
  return { eventId: row.event_id, summary: row.summary, startIso: row.start_iso, endIso: row.end_iso, createdAt: row.created_at };
}

export async function getAppointmentForPhone(tenantId: string, phone: string): Promise<TrackedAppointment | undefined> {
  const db = getDb();
  const { data } = await db.from('appointments').select('*').eq('tenant_id', tenantId).eq('phone', phone).maybeSingle();
  return data ? toTracked(data as AppointmentRow) : undefined;
}

export async function setAppointmentForPhone(tenantId: string, phone: string, appt: Omit<TrackedAppointment, 'createdAt'>): Promise<void> {
  const db = getDb();
  const { error } = await db.from('appointments').upsert(
    {
      tenant_id: tenantId,
      phone,
      event_id: appt.eventId,
      summary: appt.summary,
      start_iso: appt.startIso,
      end_iso: appt.endIso,
      created_at: new Date().toISOString(),
    },
    { onConflict: 'tenant_id,phone' }
  );
  if (error) throw error;
}

export async function clearAppointmentForPhone(tenantId: string, phone: string): Promise<void> {
  const db = getDb();
  await db.from('appointments').delete().eq('tenant_id', tenantId).eq('phone', phone);
}

/** Todos os agendamentos ativos de um tenant — usado pelo job de lembretes automáticos pra saber a quem enviar. */
export async function listAllAppointments(tenantId: string): Promise<Array<{ phone: string } & TrackedAppointment>> {
  const db = getDb();
  const { data, error } = await db.from('appointments').select('*').eq('tenant_id', tenantId);
  if (error) throw error;
  return (data as AppointmentRow[]).map((row) => ({ phone: row.phone, ...toTracked(row) }));
}
