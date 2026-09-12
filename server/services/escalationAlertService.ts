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
 * o próprio dono reportou como indesejado. Ficou só push até a TASK-0399.
 *
 * TASK-0399 (12/09/2026): "são modelos de negócio diferentes, necessidades
 * diferentes" — o WhatsApp pro admin_alert_phone volta a existir, mas agora
 * como escolha explícita por tenant (`alert_preferences.escalation`/
 * `.payment_pending`, tenantProfileStore.ts), default `false` pra não
 * reativar silenciosamente o mesmo incômodo que motivou a remoção original.
 * Pagamento pendente (`kind === 'payment_proof'`) e escalonamento geral
 * (qualquer outro kind) usam templates e a chave de preferência distintos.
 *
 * A deduplicação é feita antes deste serviço, no store de escalonamentos:
 * recorrências da mesma fonte estável (por exemplo, o revisor para o mesmo
 * telefone) atualizam o cartão e seu contador, sem gerar um novo aviso. Fontes
 * diferentes continuam podendo alertar o operador, porque representam riscos
 * distintos e não devem ser ocultadas silenciosamente.
 */
import { getDb } from './db';
import { sendAdminAlert } from './adminAlertChannel';
import { sendPushToTenant } from './webPush';
import type { EscalationKind } from './escalationStore';

export interface EscalationForAlert {
  phone: string;
  contactName?: string;
  reason: string;
  kind: EscalationKind;
}

/**
 * Template aprovado no Meta Business Manager (categoria Utilitário) —
 * mesmo corpo já documentado antes da remoção na TASK-0298: "🚨 Nova
 * escalação em {{1}}: {{2}} — {{3}}. Confira no painel." ({{1}} nome do
 * tenant, {{2}} nome/telefone do lead, {{3}} motivo). PENDENTE: aprovação no
 * Meta Business Manager não confirmada — mesma pendência que já existia
 * antes da remoção, não é um risco novo desta tarefa.
 */
const ESCALATION_TEMPLATE_NAME = 'escalonamento_alerta';
const ESCALATION_TEMPLATE_LANGUAGE = 'pt_BR';

/**
 * Template novo (TASK-0399) pra pagamento pendente de verificação — antes
 * disso esse `kind` nunca teve WhatsApp próprio, só herdava o mesmo
 * comportamento de escalonamento geral. PENDENTE: precisa ser criado e
 * aprovado no Meta Business Manager antes de funcionar de verdade pra
 * tenants no canal Meta (tenants no canal Evolution recebem por texto
 * livre, sem depender de aprovação nenhuma).
 */
const PAYMENT_PENDING_TEMPLATE_NAME = 'pagamento_pendente_alerta';
const PAYMENT_PENDING_TEMPLATE_LANGUAGE = 'pt_BR';

export async function notifyEscalationCreated(tenantId: string, escalation: EscalationForAlert): Promise<void> {
  const leadLabel = escalation.contactName || escalation.phone;

  // Canal 1: push pro PWA do atendente (issue #159) — incondicional, nunca
  // depende da preferência de WhatsApp abaixo. Nunca lança (sendPushToTenant
  // já engole erro de assinatura individual).
  await sendPushToTenant(tenantId, {
    title: '🚨 Nova escalação',
    body: `${leadLabel} — ${escalation.reason}`,
    tag: `escalation-${escalation.phone}`,
  });

  // Canal 2: WhatsApp pro admin_alert_phone — condicionado à preferência do
  // tenant (default false, ver comentário de topo do arquivo).
  const db = getDb();
  const { data: tenant } = await db
    .from('tenants')
    .select('name, admin_alert_phone, alert_preferences')
    .eq('id', tenantId)
    .maybeSingle();

  const adminPhone = tenant?.admin_alert_phone as string | undefined;
  if (!adminPhone) return;

  const isPaymentPending = escalation.kind === 'payment_proof';
  const preferences = (tenant?.alert_preferences as Record<string, boolean> | null) || {};
  const enabled = isPaymentPending ? preferences.payment_pending === true : preferences.escalation === true;
  if (!enabled) return;

  const tenantName = (tenant?.name as string | undefined) || tenantId;

  if (isPaymentPending) {
    await sendAdminAlert(tenantId, adminPhone, {
      templateName: PAYMENT_PENDING_TEMPLATE_NAME,
      templateLanguage: PAYMENT_PENDING_TEMPLATE_LANGUAGE,
      templateArgs: [tenantName, leadLabel, escalation.reason],
      freeText: `💳 Pagamento pendente em ${tenantName}: ${leadLabel} — ${escalation.reason}. Confira no painel.`,
    });
  } else {
    await sendAdminAlert(tenantId, adminPhone, {
      templateName: ESCALATION_TEMPLATE_NAME,
      templateLanguage: ESCALATION_TEMPLATE_LANGUAGE,
      templateArgs: [tenantName, leadLabel, escalation.reason],
      freeText: `🚨 Nova escalação em ${tenantName}: ${leadLabel} — ${escalation.reason}. Confira no painel.`,
    });
  }
}
