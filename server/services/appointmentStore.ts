/**
 * Rastreia o agendamento ATIVO (evento do Google Calendar) de cada número de
 * telefone — necessário pra remarcar/cancelar sem depender do modelo
 * "lembrar" ou inventar um eventId. Migrado pra tabela Postgres
 * `appointments` (Bloco 2.A), chave (tenant_id, phone).
 */
import { getDb } from './db';
import { withStructuredLog } from './structuredLog';

export type PaymentStatus = 'awaiting_payment' | 'pending_verification' | 'verified' | 'confirmed' | 'rejected';

export interface TrackedAppointment {
  /**
   * undefined = ainda é só uma RESERVA (issue #289), sem evento real no
   * Google Calendar — só existe depois que um operador aprova o comprovante
   * (ver attachCalendarEventToHold). Nesse estado paymentStatus é sempre
   * 'awaiting_payment' e heldUntil está preenchido.
   */
  eventId?: string;
  summary: string;
  startIso: string;
  endIso: string;
  createdAt: string;
  /** undefined = nenhum comprovante enviado ainda. Ver docs/AGENTE-VERTICAL-ARQUITETURA.md, seção 4.3. */
  paymentStatus?: PaymentStatus;
  paymentProofMessageId?: string;
  paymentVerifiedBy?: string;
  paymentVerifiedAt?: string;
  /** Até quando uma reserva sem evento real (paymentStatus 'awaiting_payment') continua válida antes de expirar — ver heldAppointmentExpiryJob.ts (issue #289). */
  heldUntil?: string;
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
  event_id: string | null;
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
  held_until: string | null;
  source: 'ai' | 'manual' | null;
};

function toTracked(row: AppointmentRow): TrackedAppointment {
  return {
    eventId: row.event_id || undefined,
    summary: row.summary,
    startIso: row.start_iso,
    endIso: row.end_iso,
    createdAt: row.created_at,
    paymentStatus: row.payment_status || undefined,
    paymentProofMessageId: row.payment_proof_message_id || undefined,
    paymentVerifiedBy: row.payment_verified_by || undefined,
    paymentVerifiedAt: row.payment_verified_at || undefined,
    heldUntil: row.held_until || undefined,
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

/**
 * `resetPaymentState`: true só quando esta chamada representa um
 * agendamento genuinamente NOVO (criar_agendamento) — nunca uma remarcação
 * (remarcar_agendamento chama isto sem essa flag). Sem isso, um upsert pra
 * um telefone que já tinha uma linha antiga (ex: agendamento passado, já
 * pago) mantinha o payment_status velho grudado no agendamento novo, porque
 * o upsert só escreve as colunas listadas aqui — colunas de pagamento nunca
 * apareciam no payload, então o Postgres simplesmente preservava o valor
 * anterior (achado real em produção, ver criar_agendamento em autoReply.ts).
 */
export async function setAppointmentForPhone(
  tenantId: string,
  phone: string,
  appt: Omit<TrackedAppointment, 'createdAt'>,
  opts?: { resetPaymentState?: boolean }
): Promise<void> {
  const db = getDb();
  const payload: Record<string, unknown> = {
    tenant_id: tenantId,
    phone,
    event_id: appt.eventId ?? null,
    summary: appt.summary,
    start_iso: appt.startIso,
    end_iso: appt.endIso,
    created_at: new Date().toISOString(),
    source: appt.source || 'ai',
  };
  if (opts?.resetPaymentState) {
    payload.payment_status = null;
    payload.payment_proof_message_id = null;
    payload.payment_verified_by = null;
    payload.payment_verified_at = null;
    payload.payment_pending_since = null;
    payload.payment_pending_alerted_at = null;
    payload.payment_receipt_hint = null;
    payload.held_until = null;
  }
  const { error } = await db.from('appointments').upsert(payload, { onConflict: 'tenant_id,phone' });
  if (error) throw error;
}

/**
 * Corrige o nome do serviço de um agendamento já existente — pedido real
 * (19/08/2026): não existia NENHUM jeito de editar um evento depois de
 * criado (só criar/remarcar horário/cancelar/marcar concluído), então um
 * agendamento manual com o serviço errado (ex: registrado como "Cejas
 * Microshading" numa conversa que era sobre pestañas) ficava errado pra
 * sempre no painel, mesmo depois de corrigir o evento real no Google
 * Calendar. Busca por `event_id` (não por telefone) porque quem chama já
 * corrigiu o evento real e só tem o eventId em mãos — melhor esforço:
 * sem linha correspondente (ex: evento criado direto no Google, fora do
 * app), não é erro, só não tem nada pra sincronizar aqui.
 */
export async function updateAppointmentSummaryByEventId(tenantId: string, eventId: string, summary: string): Promise<void> {
  const db = getDb();
  await db.from('appointments').update({ summary }).eq('tenant_id', tenantId).eq('event_id', eventId);
}

export async function clearAppointmentForPhone(tenantId: string, phone: string): Promise<void> {
  const db = getDb();
  await db.from('appointments').delete().eq('tenant_id', tenantId).eq('phone', phone);
}

export interface CreateAppointmentHoldInput {
  summary: string;
  startIso: string;
  endIso: string;
  /** ISO — quando esta reserva expira se ninguém aprovar um comprovante até lá (ver heldAppointmentExpiryJob.ts). */
  heldUntil: string;
}

/**
 * Issue #289 (decisão do dono do produto, 18/08/2026) — criar_agendamento
 * não cria mais o evento real no Google Calendar direto: só reserva o
 * horário (sem eventId) até um operador aprovar o comprovante de pagamento
 * (ver attachCalendarEventToHold, chamada por POST /verify-payment). Sempre
 * reseta qualquer estado de pagamento de um ciclo anterior — mesma garantia
 * de resetPaymentState em setAppointmentForPhone, porque isto só é chamado
 * quando já foi confirmado que este telefone não tem agendamento/reserva
 * ativa (ver criar_agendamento em autoReply.ts).
 */
export async function createAppointmentHold(tenantId: string, phone: string, input: CreateAppointmentHoldInput): Promise<void> {
  return withStructuredLog({ tenantId, area: 'appointmentStore', op: 'createAppointmentHold' }, async () => {
    const db = getDb();
    const { error } = await db.from('appointments').upsert(
      {
        tenant_id: tenantId,
        phone,
        event_id: null,
        summary: input.summary,
        start_iso: input.startIso,
        end_iso: input.endIso,
        created_at: new Date().toISOString(),
        source: 'ai',
        payment_status: 'awaiting_payment',
        payment_proof_message_id: null,
        payment_verified_by: null,
        payment_verified_at: null,
        payment_pending_since: null,
        payment_pending_alerted_at: null,
        payment_receipt_hint: null,
        held_until: input.heldUntil,
      },
      { onConflict: 'tenant_id,phone' }
    );
    if (error) throw error;
  });
}

/**
 * Operador aprovou o comprovante de uma reserva que ainda não tinha evento
 * real no Calendar (issue #289) — grava o evento criado agora (ver POST
 * /verify-payment) e encerra a expiração, já que a reserva virou um
 * agendamento de verdade.
 */
export async function attachCalendarEventToHold(tenantId: string, phone: string, eventId: string): Promise<void> {
  return withStructuredLog({ tenantId, area: 'appointmentStore', op: 'attachCalendarEventToHold' }, async () => {
    const db = getDb();
    const { error } = await db
      .from('appointments')
      .update({ event_id: eventId, held_until: null })
      .eq('tenant_id', tenantId)
      .eq('phone', phone);
    if (error) throw error;
  });
}

/**
 * Reserva de OUTRO telefone, ainda aguardando pagamento (sem evento real),
 * que colide com o intervalo pedido — usado por criar_agendamento pra
 * reduzir (não eliminar — decisão explícita do dono do produto, issue #289)
 * o risco de dois clientes disputarem o mesmo horário enquanto o primeiro
 * ainda não pagou.
 */
export async function findOverlappingHold(tenantId: string, phone: string, startIso: string, endIso: string): Promise<TrackedAppointment | undefined> {
  const db = getDb();
  const { data, error } = await db.from('appointments').select('*').eq('tenant_id', tenantId).eq('payment_status', 'awaiting_payment');
  if (error) throw error;
  const startMs = Date.parse(`${startIso}Z`);
  const endMs = Date.parse(`${endIso}Z`);
  const overlapping = (data as AppointmentRow[]).find(
    (row) => row.phone !== phone && Date.parse(`${row.start_iso}Z`) < endMs && Date.parse(`${row.end_iso}Z`) > startMs
  );
  return overlapping ? toTracked(overlapping) : undefined;
}

/** Todos os tenant_id distintos com ao menos uma reserva (issue #289) já vencida — usado pelo job de expiração (heldAppointmentExpiryJob.ts). */
export async function listTenantIdsWithExpiredHolds(): Promise<string[]> {
  const db = getDb();
  const { data, error } = await db.from('appointments').select('tenant_id').eq('payment_status', 'awaiting_payment').lt('held_until', new Date().toISOString());
  if (error) throw error;
  const ids = new Set(((data || []) as { tenant_id: string }[]).map((row) => row.tenant_id));
  return Array.from(ids);
}

/** Reservas vencidas de um tenant (issue #289) — usado pelo job de expiração pra liberar o horário pra outro cliente. */
export async function listExpiredHolds(tenantId: string): Promise<Array<{ phone: string } & TrackedAppointment>> {
  const db = getDb();
  const { data, error } = await db.from('appointments').select('*').eq('tenant_id', tenantId).eq('payment_status', 'awaiting_payment').lt('held_until', new Date().toISOString());
  if (error) throw error;
  return (data as AppointmentRow[]).map((row) => ({ phone: row.phone, ...toTracked(row) }));
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
  return withStructuredLog({ tenantId, area: 'appointmentStore', op: 'markPaymentPendingVerification' }, async () => {
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
        // Issue #289 — se isto vinha de uma reserva 'awaiting_payment', o
        // comprovante chegou a tempo: encerra a expiração (o job de
        // heldAppointmentExpiryJob.ts só olha payment_status='awaiting_payment',
        // então não afeta mais este ciclo, mas limpa por clareza).
        held_until: null,
      })
      .eq('tenant_id', tenantId)
      .eq('phone', phone);
    if (error) throw error;
  });
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
  return withStructuredLog({ tenantId, area: 'appointmentStore', op: `setPaymentVerification:${status}` }, async () => {
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
  });
}

/** Libera a mensagem de confirmação de turno (seção 21 do script) só depois do operador verificar. */
export async function confirmPayment(tenantId: string, phone: string): Promise<TrackedAppointment | undefined> {
  return withStructuredLog({ tenantId, area: 'appointmentStore', op: 'confirmPayment' }, async () => {
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
  });
}
