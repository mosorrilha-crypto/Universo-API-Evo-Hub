/**
 * Job de expiração de reservas sem pagamento (issue #289, 18/08/2026):
 * criar_agendamento não cria mais o evento real no Google Calendar direto —
 * só reserva o horário (`payment_status = 'awaiting_payment'`, sem eventId)
 * até um operador aprovar o comprovante (ver appointmentStore.ts,
 * createAppointmentHold/attachCalendarEventToHold). Se o cliente nunca manda
 * o comprovante, essa reserva precisa liberar o horário sozinha depois de um
 * tempo — sem isso, um telefone ficaria bloqueado pra sempre (criar_agendamento
 * recusa um segundo pedido enquanto existir um paymentStatus 'awaiting_payment'
 * não resolvido) e o horário nunca reapareceria como livre pra outro cliente
 * (checkFreeBusy só olha o Calendar real, mas findOverlappingHold olha esta
 * reserva).
 *
 * Mesmo padrão de job periódico de preReservationFollowUpJob.ts/
 * paymentPendingAlertJob.ts (roda uma vez + setInterval a cada 15min) —
 * simplesmente apaga a linha (clearAppointmentForPhone), sem alertar
 * ninguém: o cliente só não pagou a tempo, não é uma falha do sistema que
 * precise de atenção humana.
 */
import { listTenantIdsWithExpiredHolds, listExpiredHolds, clearAppointmentForPhone } from './appointmentStore';
import { startPeriodicJob } from './periodicJob';

const DEFAULT_INTERVAL_MS = 15 * 60 * 1000;

async function expireHoldsForTenant(tenantId: string): Promise<void> {
  let expired: Array<{ phone: string; summary: string; startIso: string }>;
  try {
    expired = await listExpiredHolds(tenantId);
  } catch (err) {
    console.warn(`⚠️  [Expiração de reserva] tenant=${tenantId} falha ao listar reservas vencidas:`, (err as Error).message);
    return;
  }
  for (const hold of expired) {
    try {
      await clearAppointmentForPhone(tenantId, hold.phone);
      console.log(`🗓️  [Expiração de reserva] tenant=${tenantId} liberou o horário de ${hold.phone} ("${hold.summary}" em ${hold.startIso}) — comprovante nunca chegou a tempo.`);
    } catch (err) {
      console.warn(`⚠️  [Expiração de reserva] tenant=${tenantId} falha ao liberar reserva de ${hold.phone}:`, (err as Error).message);
    }
  }
}

export interface HeldAppointmentExpiryJobDeps {
  intervalMs?: number;
}

/** Uma passada do job (todos os tenants com reserva vencida) — exportada separada do setInterval pra ser chamada diretamente nos testes. */
export async function expireStaleHolds(): Promise<void> {
  let tenantIds: string[];
  try {
    tenantIds = await listTenantIdsWithExpiredHolds();
  } catch (err) {
    console.warn('⚠️  [Expiração de reserva] Falha ao listar tenants com reserva vencida:', (err as Error).message);
    return;
  }
  for (const tenantId of tenantIds) {
    await expireHoldsForTenant(tenantId);
  }
}

/** Roda uma vez imediatamente e depois a cada `intervalMs` (padrão 15 min) — mesmo padrão de startPaymentPendingAlertJob. */
export function startHeldAppointmentExpiryJob(deps: HeldAppointmentExpiryJobDeps = {}): void {
  const intervalMs = deps.intervalMs ?? DEFAULT_INTERVAL_MS;
  startPeriodicJob(
    'expiracao-reservas-retidas',
    intervalMs,
    expireStaleHolds,
    (err) => console.warn('⚠️  [Expiração de reserva] Erro no job:', err instanceof Error ? err.message : String(err)),
  );
}
