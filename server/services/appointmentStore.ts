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
  /** Desde quando está 'pending_verification' — usado pelo job de alerta (issue #98). */
  paymentPendingSince?: string;
  paymentPendingAlertedAt?: string;
  /** Dica gerada pelo Gemini a partir da imagem do comprovante — nunca confirma pagamento sozinha, só ajuda o operador a decidir mais rápido no painel. Ver paymentReceiptAnalysis.ts. */
  paymentReceiptHint?: string;
  /**
   * 'ai' (default) = criado pela própria IA via criar_agendamento/
   * remarcar_agendamento. 'manual' = operador cadastrou no painel um
   * agendamento fechado fora da IA (issue #182) — mesmo evento real no
   * Google Calendar e mesmo lembrete automático, mas NUNCA dispara o
   * evento Purchase pro Meta CAPI (sem origem de anúncio rastreável,
   * distorceria a métrica de atribuição de tráfego pago — decisão do dono
   * do produto, 12/08/2026).
   */
  source?: 'ai' | 'manual';
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
  payment_pending_since: string | null;
  payment_pending_alerted_at: string | null;
  payment_receipt_hint: string | null;
  source: 'ai' | 'manual' | null;
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
    paymentPendingSince: row.payment_pending_since || undefined,
    paymentPendingAlertedAt: row.payment_pending_alerted_at || undefined,
    paymentReceiptHint: row.payment_receipt_hint || undefined,
    source: row.source || 'ai',
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
      source: appt.source || 'ai',
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
export async function markPaymentPendingVerification(tenantId: string, phone: string, proofMessageId: string, receiptHint?: string): Promise<void> {
  const db = getDb();
  const { error } = await db
    .from('appointments')
    .update({
      payment_status: 'pending_verification',
      payment_proof_message_id: proofMessageId,
      payment_pending_since: new Date().toISOString(),
      // reseta pra permitir um novo alerta se o cliente reenviar um comprovante
      // depois de uma rejeição anterior (novo ciclo de verificação).
      payment_pending_alerted_at: null,
      // idem — dica de um ciclo anterior não deve sobreviver pro reenvio.
      payment_receipt_hint: receiptHint || null,
    })
    .eq('tenant_id', tenantId)
    .eq('phone', phone);
  if (error) throw error;
}

/** Marca que o job de alerta (issue #98) já avisou o operador sobre ESTE ciclo de verificação pendente — nunca duplica. */
export async function markPaymentPendingAlerted(tenantId: string, phone: string): Promise<void> {
  const db = getDb();
  const { error } = await db
    .from('appointments')
    .update({ payment_pending_alerted_at: new Date().toISOString() })
    .eq('tenant_id', tenantId)
    .eq('phone', phone);
  if (error) throw error;
}

/** Todos os tenant_id distintos com ao menos um agendamento com pagamento pendente de verificação — usado pelo job de alerta (issue #98). */
export async function listTenantIdsWithPendingPaymentVerification(): Promise<string[]> {
  const db = getDb();
  const { data, error } = await db.from('appointments').select('tenant_id').eq('payment_status', 'pending_verification');
  if (error) throw error;
  const ids = new Set(((data || []) as { tenant_id: string }[]).map((row) => row.tenant_id));
  return Array.from(ids);
}

/** Agendamentos de um tenant com pagamento pendente de verificação — usado pelo job de alerta (issue #98). */
export async function listPendingPaymentVerifications(tenantId: string): Promise<Array<{ phone: string } & TrackedAppointment>> {
  const db = getDb();
  const { data, error } = await db.from('appointments').select('*').eq('tenant_id', tenantId).eq('payment_status', 'pending_verification');
  if (error) throw error;
  return (data as AppointmentRow[]).map((row) => ({ phone: row.phone, ...toTracked(row) }));
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
