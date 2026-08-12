/**
 * Job de alerta de pagamento pendente de verificação há mais de 2h (issue
 * #98, item 4.5.10 de docs/PLANO-EVOLUCAO.md). A Etapa 8 (verificação de
 * transferência) já marca `payment_status = 'pending_verification'` quando
 * um comprovante chega e já existe o painel pro operador confirmar/rejeitar
 * — mas se ninguém abrir a conversa, o pagamento pode ficar assim
 * indefinidamente sem ninguém saber, com o cliente já pago e esperando.
 *
 * Nunca confirma/rejeita pagamento sozinho — só alerta, mesma cautela de
 * "quem decide é sempre um humano" já usada em preReservationFollowUpJob.ts.
 * Reusa logEscalation (escalationStore.ts), que já dispara o alerta push +
 * WhatsApp template pro admin_alert_phone do tenant automaticamente
 * (escalationAlertService.ts) — nenhum canal de alerta novo precisa ser
 * criado ou aprovado no Meta Business Manager pra isso funcionar.
 *
 * Mesmo padrão de job periódico de preReservationFollowUpJob.ts (roda uma
 * vez + setInterval a cada 15min), iterando appointments com payment_status
 * = 'pending_verification' há mais de `thresholdMs` (padrão 2h) e ainda não
 * alertados (payment_pending_alerted_at null).
 */
import {
  listTenantIdsWithPendingPaymentVerification,
  listPendingPaymentVerifications,
  markPaymentPendingAlerted,
} from './appointmentStore';
import { getConversation } from './conversationStore';
import { logEscalation } from './escalationStore';

const DEFAULT_INTERVAL_MS = 15 * 60 * 1000;
const DEFAULT_THRESHOLD_MS = 2 * 60 * 60 * 1000;

async function checkPaymentPendingForTenant(tenantId: string, thresholdMs: number): Promise<void> {
  let pending: Array<{ phone: string; paymentPendingSince?: string; paymentPendingAlertedAt?: string }>;
  try {
    pending = await listPendingPaymentVerifications(tenantId);
  } catch (err) {
    console.warn(`⚠️  [Alerta pagamento pendente] tenant=${tenantId} falha ao listar pagamentos pendentes:`, (err as Error).message);
    return;
  }

  const now = Date.now();
  for (const appt of pending) {
    if (appt.paymentPendingAlertedAt) continue; // idempotência — já alertou pra esse ciclo de verificação
    if (!appt.paymentPendingSince) continue; // dado legado sem timestamp — nada a comparar, ignora
    const pendingSinceMs = new Date(appt.paymentPendingSince).getTime();
    if (now - pendingSinceMs < thresholdMs) continue; // ainda dentro do prazo tolerado

    try {
      const conv = await getConversation(tenantId, appt.phone);
      const pendingHours = Math.round((now - pendingSinceMs) / 3600000);
      await logEscalation(
        tenantId,
        appt.phone,
        conv?.name,
        `Pagamento pendente de verificação há ${pendingHours}h — cliente enviou comprovante e está esperando confirmação.`
      );
      await markPaymentPendingAlerted(tenantId, appt.phone);
      console.log(`🔔 [Alerta pagamento pendente] tenant=${tenantId} alertou sobre ${appt.phone} (pendente há ${pendingHours}h).`);
    } catch (err) {
      console.warn(`⚠️  [Alerta pagamento pendente] tenant=${tenantId} falha ao alertar sobre ${appt.phone}:`, (err as Error).message);
    }
  }
}

export interface PaymentPendingAlertJobDeps {
  intervalMs?: number;
  thresholdMs?: number;
}

/** Uma passada do job (todos os tenants com pagamento pendente) — exportada separada do setInterval pra ser chamada diretamente nos testes. */
export async function checkPaymentPendingAndAlert(deps: PaymentPendingAlertJobDeps = {}): Promise<void> {
  const thresholdMs = deps.thresholdMs ?? DEFAULT_THRESHOLD_MS;
  let tenantIds: string[];
  try {
    tenantIds = await listTenantIdsWithPendingPaymentVerification();
  } catch (err) {
    console.warn('⚠️  [Alerta pagamento pendente] Falha ao listar tenants com pagamento pendente:', (err as Error).message);
    return;
  }
  for (const tenantId of tenantIds) {
    await checkPaymentPendingForTenant(tenantId, thresholdMs);
  }
}

/** Roda uma vez imediatamente e depois a cada `intervalMs` (padrão 15 min) — mesmo padrão de startPreReservationFollowUpJob. */
export function startPaymentPendingAlertJob(deps: PaymentPendingAlertJobDeps = {}): void {
  const intervalMs = deps.intervalMs ?? DEFAULT_INTERVAL_MS;
  const run = () => checkPaymentPendingAndAlert(deps).catch((err) => console.warn('⚠️  [Alerta pagamento pendente] Erro no job:', err.message));
  run();
  setInterval(run, intervalMs);
}
