/**
 * Issue #111 — hoje um erro real de produção (crash, unhandledRejection,
 * rota que devolve 500) só aparece nos logs do Render — ninguém é avisado
 * até um cliente reclamar ou alguém for catar log por acaso. Isto fecha
 * esse buraco SEM depender de nenhum serviço externo (Sentry etc.): reusa
 * os dois canais de alerta já existentes neste projeto (push pro PWA do
 * atendente + template do WhatsApp pro admin_alert_phone), mesmo padrão de
 * escalationAlertService.ts/agentPausedAlertJob.ts.
 *
 * Erro de sistema não é por-tenant como escalonamento — um crash ou
 * unhandledRejection ameaça o processo inteiro (todo mundo hospedado nele),
 * então alerta TODOS os tenants com admin_alert_phone configurado, não só
 * um. Cooldown global simples (padrão 15min) evita virar spam quando um
 * mesmo bug dispara repetidamente em rajada — não é por-tenant nem por-tipo
 * de erro de propósito: no volume atual (poucos tenants reais), "avisou
 * recentemente que algo está quebrado" já é suficiente pra não perder o
 * primeiro sinal.
 *
 * Canal 2 (WhatsApp) via adminAlertChannel.ts (issue #290, seção 1) — antes
 * chamava resolveMetaCredentialsForTenant direto com `{}` de fallback,
 * nunca alcançava a credencial Meta global nem tentava Evolution API pro
 * tenant que atende de verdade por lá.
 */
import { getDb } from './db';
import { sendAdminAlert } from './adminAlertChannel';
import { sendPushToTenant } from './webPush';

/** Template aprovado no Meta Business Manager (categoria Utilitário) — corpo sugerido: "⚠️ Erro real no sistema {{1}}: {{2}}. Confira os logs do servidor." — {{1}} de onde veio o erro, {{2}} mensagem resumida, nessa ordem. */
const TEMPLATE_NAME = 'sistema_erro_alerta';
const TEMPLATE_LANGUAGE = 'pt_BR';
const DEFAULT_COOLDOWN_MS = 15 * 60 * 1000;

let lastAlertAtMs = 0;

export interface SystemErrorDetails {
  /** De onde veio — ex: "unhandledRejection", "uncaughtException", "POST /api/conversations/:phone/send-message". */
  source: string;
  message: string;
}

interface TenantAlertRow {
  id: string;
  name: string | null;
  admin_alert_phone: string | null;
}

async function alertTenant(row: TenantAlertRow, details: SystemErrorDetails): Promise<void> {
  const tenantName = row.name || row.id;

  // Canal 1: push pro PWA do atendente — mesmo padrão dos outros alertas,
  // nunca lança (sendPushToTenant engole erro de assinatura individual).
  await sendPushToTenant(row.id, {
    title: '🔥 Erro real no sistema',
    body: `${details.source}: ${details.message}`.slice(0, 180),
    tag: 'system-error',
  });

  const adminPhone = row.admin_alert_phone;
  if (!adminPhone) {
    console.warn(`⚠️  [Alerta de erro de sistema] tenant=${row.id} sem admin_alert_phone configurado — sem alerta via WhatsApp (push, se configurado, ainda foi tentado acima).`);
    return;
  }

  try {
    const shortMessage = details.message.slice(0, 300);
    await sendAdminAlert(row.id, adminPhone, {
      templateName: TEMPLATE_NAME,
      templateLanguage: TEMPLATE_LANGUAGE,
      templateArgs: [details.source, shortMessage],
      freeText: `⚠️ Erro real no sistema ${details.source}: ${shortMessage}. Confira os logs do servidor.`,
    });
    console.log(`🔔 [Alerta de erro de sistema] tenant=${row.id} avisou ${adminPhone} — ${details.source}: ${details.message}`);
  } catch (err) {
    console.warn(`⚠️  [Alerta de erro de sistema] tenant=${row.id} falha ao mandar WhatsApp:`, (err as Error).message);
  }
}

/**
 * Chamado pelos handlers de unhandledRejection/uncaughtException e pelo
 * middleware de erro global (server.ts) sempre que um erro real e
 * inesperado acontece. Nunca lança — um alerta quebrado nunca pode virar um
 * segundo erro em cima do primeiro.
 */
export async function notifySystemError(details: SystemErrorDetails, cooldownMs: number = DEFAULT_COOLDOWN_MS): Promise<void> {
  const now = Date.now();
  if (now - lastAlertAtMs < cooldownMs) return; // já avisou recentemente — evita rajada de spam
  lastAlertAtMs = now;

  try {
    const db = getDb();
    const { data, error } = await db.from('tenants').select('id, name, admin_alert_phone');
    if (error) throw error;
    const tenants = (data as TenantAlertRow[]) || [];
    await Promise.all(tenants.map((row) => alertTenant(row, details).catch((err) => console.warn(`⚠️  [Alerta de erro de sistema] tenant=${row.id} falha:`, (err as Error).message))));
  } catch (err) {
    console.warn('⚠️  [Alerta de erro de sistema] Falha ao notificar tenants:', (err as Error).message);
  }
}

/** Só pra testes — reseta o cooldown entre casos. */
export function resetSystemErrorAlertCooldownForTests(): void {
  lastAlertAtMs = 0;
}
