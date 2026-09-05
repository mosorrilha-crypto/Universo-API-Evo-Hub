/**
 * Avisa o operador IMEDIATAMENTE quando uma escalação nova é criada — nunca
 * espera um job periódico. Achado no benchmark de mercado (comparação com
 * outros agentes de WhatsApp, ver artefato do fluxograma): cada 30s de
 * atraso no handoff aumenta o abandono do cliente em ~10%; um job de 15min
 * (como agentPausedAlertJob.ts, pra pausa geral do agente) seria tarde
 * demais pra esse sinal específico — uma reclamação ou um agendamento
 * incerto precisa chegar ao operador em segundos, não em até 15 minutos.
 *
 * TASK-0298 (05/09/2026): removido o canal de WhatsApp pro admin_alert_phone
 * (template "escalonamento_alerta") — chegava como mensagem no WhatsApp
 * pessoal do dono do tenant, junto com as conversas reais dos leads, o que
 * o próprio dono reportou como indesejado. O alerta agora fica só "no
 * sistema": push pro PWA do atendente (Canal 1, abaixo) e o card na
 * EscalationsPanel do painel. `admin_alert_phone`/`sendAdminAlert` continuam
 * em uso por outros alertas (agentPausedAlertJob.ts, paymentPendingAlertJob.ts)
 * — não removidos daqui.
 *
 * A deduplicação é feita antes deste serviço, no store de escalonamentos:
 * recorrências da mesma fonte estável (por exemplo, o revisor para o mesmo
 * telefone) atualizam o cartão e seu contador, sem gerar um novo aviso. Fontes
 * diferentes continuam podendo alertar o operador, porque representam riscos
 * distintos e não devem ser ocultadas silenciosamente.
 */
import { sendPushToTenant } from './webPush';

export interface EscalationForAlert {
  phone: string;
  contactName?: string;
  reason: string;
}

export async function notifyEscalationCreated(tenantId: string, escalation: EscalationForAlert): Promise<void> {
  const leadLabel = escalation.contactName || escalation.phone;

  // Canal 1 (único, desde TASK-0298): push pro PWA do atendente (issue #159).
  // Nunca lança (sendPushToTenant já engole erro de assinatura individual).
  await sendPushToTenant(tenantId, {
    title: '🚨 Nova escalação',
    body: `${leadLabel} — ${escalation.reason}`,
    tag: `escalation-${escalation.phone}`,
  });
}
