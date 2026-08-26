/**
 * Job de follow-up de pré-reserva vencida (Etapa 7, docs/AGENTE-VERTICAL-
 * ARQUITETURA.md seção 7 item 7). Hoje pre_reservations (Etapa 1) fica com
 * status 'pending' pra sempre até alguém olhar manualmente — este job, na
 * data combinada (committed_date), alerta o OPERADOR (nunca manda mensagem
 * automática pro cliente nem confirma/libera nada sozinho — decisão
 * explícita do dono do produto, mesma cautela de "quem decide é sempre um
 * humano" já usada no fluxo de pagamento/cancelamento).
 *
 * Mesmo padrão de job periódico de server/services/reminderJob.ts (roda
 * uma vez + setInterval), mas itera por listTenantIdsWithPendingPreReservations()
 * em vez de listConnectedCalendarTenants() — pré-reserva não depende de
 * Google Calendar conectado (é só um registro de follow-up, não um evento
 * real na agenda).
 */
import { listTenantIdsWithPendingPreReservations, listPendingPreReservations, markFollowUpAlerted, type PreReservation } from './preReservationStore';
import { logEscalation } from './escalationStore';
import { startPeriodicJob } from './periodicJob';
import { runWithTenantDbContext } from './tenantDbContext';

const BUSINESS_TIMEZONE = 'America/Asuncion';
const DEFAULT_INTERVAL_MS = 15 * 60 * 1000;

/** "YYYY-MM-DD" de hoje no fuso do negócio. */
function todayDateKeyInTz(): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: BUSINESS_TIMEZONE,
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date());
  const map: Record<string, string> = {};
  for (const p of parts) map[p.type] = p.value;
  return `${map.year}-${map.month}-${map.day}`;
}

async function checkPreReservationFollowUpsForTenant(tenantId: string, todayKey: string): Promise<void> {
  let pending: PreReservation[];
  try {
    pending = await listPendingPreReservations(tenantId);
  } catch (err) {
    console.warn(`⚠️  [Follow-up pré-reserva] tenant=${tenantId} falha ao listar pré-reservas pendentes:`, (err as Error).message);
    return;
  }

  for (const pr of pending) {
    if (pr.followupAlertedAt) continue; // idempotência — já alertou o operador uma vez, nunca duplica

    // committed_date vem do Postgres como timestamptz (pode incluir hora/
    // offset); normaliza pros 10 primeiros chars ("YYYY-MM-DD") pra
    // comparar com hoje só pela data, sem depender de hora exata.
    const committedDateKey = pr.committedDate.slice(0, 10);
    if (committedDateKey > todayKey) continue; // data combinada ainda não chegou

    try {
      await logEscalation(
        tenantId,
        pr.phone,
        pr.contactName,
        `Pré-reserva de "${pr.serviceName}" combinada pra ${committedDateKey} — verificar se a transferência da seña chegou antes de confirmar ou liberar o horário.`,
        pr.negotiationContext
      );
      await markFollowUpAlerted(tenantId, pr.id);
      console.log(`🔔 [Follow-up pré-reserva] tenant=${tenantId} alertou o operador sobre a pré-reserva ${pr.id} (${pr.phone}, combinada pra ${committedDateKey}).`);
    } catch (err) {
      console.warn(`⚠️  [Follow-up pré-reserva] tenant=${tenantId} falha ao alertar sobre a pré-reserva ${pr.id}:`, (err as Error).message);
    }
  }
}

/** Uma passada do job (todos os tenants com pré-reserva pendente) — exportada separada do setInterval pra ser chamada diretamente nos testes. */
export async function checkPreReservationFollowUps(): Promise<void> {
  let tenantIds: string[];
  try {
    tenantIds = await listTenantIdsWithPendingPreReservations();
  } catch (err) {
    console.warn('⚠️  [Follow-up pré-reserva] Falha ao listar tenants com pré-reserva pendente:', (err as Error).message);
    return;
  }
  const todayKey = todayDateKeyInTz();
  for (const tenantId of tenantIds) {
    await runWithTenantDbContext({ tenantId, source: 'job' }, () => checkPreReservationFollowUpsForTenant(tenantId, todayKey));
  }
}

export interface PreReservationFollowUpJobDeps {
  intervalMs?: number;
}

/** Roda uma vez imediatamente e depois a cada `intervalMs` (padrão 15 min) — mesmo padrão de startReminderJob. */
export function startPreReservationFollowUpJob(deps: PreReservationFollowUpJobDeps = {}): void {
  const intervalMs = deps.intervalMs ?? DEFAULT_INTERVAL_MS;
  startPeriodicJob(
    'follow-up-pre-reserva',
    intervalMs,
    checkPreReservationFollowUps,
    (err) => console.warn('⚠️  [Follow-up pré-reserva] Erro no job:', err instanceof Error ? err.message : String(err)),
  );
}
