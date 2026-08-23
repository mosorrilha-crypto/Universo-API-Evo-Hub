/**
 * Avisa o operador (admin_alert_phone) IMEDIATAMENTE quando uma escalação
 * nova é criada — nunca espera um job periódico. Achado no benchmark de
 * mercado (comparação com outros agentes de WhatsApp, ver artefato do
 * fluxograma): cada 30s de atraso no handoff aumenta o abandono do cliente
 * em ~10%; um job de 15min (como agentPausedAlertJob.ts, pra pausa geral do
 * agente) seria tarde demais pra esse sinal específico — uma reclamação ou
 * um agendamento incerto precisa chegar ao operador em segundos, não em até
 * 15 minutos.
 *
 * Usa template aprovado pelo mesmo motivo do alerta de agente pausado: o
 * operador normalmente não tem conversa ativa recente com o número
 * comercial, então mensagem de texto livre falharia fora da janela de 24h.
 *
 * IMPORTANTE: precisa do template "escalonamento_alerta" aprovado no Meta
 * Business Manager antes de funcionar de verdade (mesmo processo já usado
 * pra "agente_pausado_alerta", ver agentPausedAlertJob.ts) — só quando o
 * canal real do tenant é Meta; via Evolution API manda texto livre, sem
 * depender de template aprovado.
 *
 * A deduplicação é feita antes deste serviço, no store de escalonamentos:
 * recorrências da mesma fonte estável (por exemplo, o revisor para o mesmo
 * telefone) atualizam o cartão e seu contador, sem gerar um novo aviso. Fontes
 * diferentes continuam podendo alertar o operador, porque representam riscos
 * distintos e não devem ser ocultadas silenciosamente.
 *
 * Canal 2 (WhatsApp) via adminAlertChannel.ts (issue #290, seção 1) — antes
 * chamava resolveMetaCredentialsForTenant direto com `{}` de fallback,
 * nunca alcançava a credencial Meta global nem tentava Evolution API pro
 * tenant que atende de verdade por lá.
 */
import { getDb } from './db';
import { sendAdminAlert } from './adminAlertChannel';
import { sendPushToTenant } from './webPush';

const TEMPLATE_NAME = 'escalonamento_alerta';
const TEMPLATE_LANGUAGE = 'pt_BR';

export interface EscalationForAlert {
  phone: string;
  contactName?: string;
  reason: string;
}

/**
 * Corpo sugerido pro template (criar/aprovar no Meta Business Manager,
 * categoria Utilitário): "🚨 Nova escalação em {{1}}: {{2}} — {{3}}. Confira
 * no painel." — {{1}} nome do tenant, {{2}} nome/telefone do lead, {{3}}
 * motivo da escalação, nessa ordem.
 */
export async function notifyEscalationCreated(tenantId: string, escalation: EscalationForAlert): Promise<void> {
  const db = getDb();
  const { data: tenant } = await db.from('tenants').select('name, admin_alert_phone').eq('id', tenantId).maybeSingle();
  const tenantName = tenant?.name || tenantId;
  const leadLabel = escalation.contactName || escalation.phone;

  // Canal 1: push pro PWA do atendente (issue #159) — independente do
  // admin_alert_phone abaixo, é por dispositivo/operador que autorizou
  // notificação, não pelo número de WhatsApp do dono do tenant. Nunca
  // lança (sendPushToTenant já engole erro de assinatura individual).
  await sendPushToTenant(tenantId, {
    title: '🚨 Nova escalação',
    body: `${leadLabel} — ${escalation.reason}`,
    tag: `escalation-${escalation.phone}`,
  });

  // Canal 2: WhatsApp template pro admin_alert_phone (canal original, já
  // existia antes do push).
  const adminPhone = tenant?.admin_alert_phone;
  if (!adminPhone) {
    console.warn(`⚠️  [Alerta de escalonamento] tenant=${tenantId} sem admin_alert_phone configurado — sem alerta via WhatsApp (push, se configurado, ainda foi tentado acima).`);
    return;
  }

  await sendAdminAlert(tenantId, adminPhone, {
    templateName: TEMPLATE_NAME,
    templateLanguage: TEMPLATE_LANGUAGE,
    templateArgs: [tenantName, leadLabel, escalation.reason],
    freeText: `🚨 Nova escalação em ${tenantName}: ${leadLabel} — ${escalation.reason}. Confira no painel.`,
  });
  console.log(`🔔 [Alerta de escalonamento] tenant=${tenantId} avisou ${adminPhone} — ${leadLabel}: ${escalation.reason}`);
}
