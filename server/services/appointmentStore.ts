/**
 * Rastreia o agendamento ATIVO (evento do Google Calendar) de cada número de
 * telefone — necessário pra remarcar/cancelar sem depender do modelo
 * "lembrar" ou inventar um eventId. Migrado pra tabela Postgres
 * `appointments` (Bloco 2.A), chave (tenant_id, phone).
 */
import { getDb } from './db';

export type PaymentStatus = 'pending_verification' | 'verified' | 'confirmed' | 'rejected';

export interface TrackedAppointment {
  eventId: string;
  summary: string;
  startIso: string;
  endIso: string;
  createdAt: string;
  /** undefined = nenhum comprovante enviado ainda. Ver docs/AGENTE-VERTICAL-ARQUITETURA.md, seção 4.3. */
  paymentStatus?: PaymentStatus;
  paymentProofMessageId?: string;
  paymentVerifiedBy?: string;
  paymentVerifiedAt?: string;
}

type AppointmentRow = {
  phone: string;
  event_id: string;
  summary: string;
  start_iso: string;
  end_iso: string;
  created_at: string;
  payment_status: PaymentStatus | null;
  payment_proof_message_id: string | null;
  payment_verified_by: string | null;
  payment_verified_at: string | null;
};

function toTracked(row: AppointmentRow): TrackedAppointment {
  return {
    eventId: row.event_id,
    summary: row.summary,
    startIso: row.start_iso,
    endIso: row.end_iso,
    createdAt: row.created_at,
    paymentStatus: row.payment_status || undefined,
    paymentProofMessageId: row.payment_proof_message_id || undefined,
    paymentVerifiedBy: row.payment_verified_by || undefined,
    paymentVerifiedAt: row.payment_verified_at || undefined,
  };
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

/**
 * A IA chama isso quando o cliente manda um comprovante — só registra que
 * "chegou algo pra verificar", nunca confirma pagamento sozinha (ver
 * docs/AGENTE-VERTICAL-ARQUITETURA.md, seção 4.3 / tabela 4.5).
 */
export async function markPaymentPendingVerification(tenantId: string, phone: string, proofMessageId: string): Promise<void> {
  const db = getDb();
  const { error } = await db
    .from('appointments')
    .update({ payment_status: 'pending_verification', payment_proof_message_id: proofMessageId })
    .eq('tenant_id', tenantId)
    .eq('phone', phone);
  if (error) throw error;
}

/**
 * Só o operador (via painel) chama isso — marca o comprovante como
 * verificado/rejeitado e registra quem verificou. A IA nunca chama esta
 * função.
 */
export async function setPaymentVerification(tenantId: string, phone: string, status: 'verified' | 'rejected', operatorId: string): Promise<TrackedAppointment | undefined> {
  const db = getDb();
  const { data, error } = await db
    .from('appointments')
    .update({ payment_status: status, payment_verified_by: operatorId, payment_verified_at: new Date().toISOString() })
    .eq('tenant_id', tenantId)
    .eq('phone', phone)
    .select('*')
    .maybeSingle();
  if (error) throw error;
  return data ? toTracked(data as AppointmentRow) : undefined;
}

/** Libera a mensagem de confirmação de turno (seção 21 do script) só depois do operador verificar. */
export async function confirmPayment(tenantId: string, phone: string): Promise<TrackedAppointment | undefined> {
  const db = getDb();
  const { data, error } = await db
    .from('appointments')
    .update({ payment_status: 'confirmed' })
    .eq('tenant_id', tenantId)
    .eq('phone', phone)
    .eq('payment_status', 'verified')
    .select('*')
    .maybeSingle();
  if (error) throw error;
  return data ? toTracked(data as AppointmentRow) : undefined;
}
