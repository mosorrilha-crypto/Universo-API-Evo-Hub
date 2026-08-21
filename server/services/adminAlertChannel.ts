/**
 * Canal de alerta ao OPERADOR (admin_alert_phone) — não é o canal de
 * mensagem real do cliente. Compartilhado pelos 3 serviços de alerta
 * (systemErrorAlertService.ts, escalationAlertService.ts,
 * agentPausedAlertJob.ts).
 *
 * Achado real em produção (issue #290, seção 1, 19/08/2026): os três
 * chamavam `resolveMetaCredentialsForTenant(tenantId, {})` — SEMPRE com
 * `{}` como fallback compartilhado, nunca recebiam a credencial Meta
 * global do .env (diferente de reminderJob.ts/webhooks.ts, que já usam
 * `resolveCredentialsForTenant` com a credencial compartilhada de verdade).
 * Resultado: alerta falhando em silêncio há dias nos dois tenants reais —
 * `falha ao mandar WhatsApp: META_PHONE_NUMBER_ID ou META_ACCESS_TOKEN
 * ausentes` — inclusive pro tenant da Monique, cujo canal real de
 * atendimento é Evolution API, não Meta (o alerta nunca tentava esse
 * canal).
 *
 * Resolve o canal REAL do tenant (mesma lógica que reminderJob.ts já usa
 * pra mensagem de cliente) e manda por lá: template aprovado se for Meta
 * (exigência da janela de 24h da Cloud API), texto livre se for Evolution
 * (sem essa restrição — não é conversa business-initiated na mesma
 * política).
 */
import { sendWhatsAppTemplateMessage } from './metaSend';
import { sendEvolutionTextMessage } from './evolutionSend';
import { resolveCredentialsForTenant, type SharedMetaCredentials, type SharedEvolutionCredentials } from './tenantResolver';

let sharedMeta: SharedMetaCredentials = {};
let sharedEvo: SharedEvolutionCredentials = {};

/** Chamado uma vez no startup (server.ts), mesmo padrão de initWebPush — credenciais compartilhadas do .env, usadas só quando o tenant não tem linha própria em tenant_meta_credentials/tenant_evolution_credentials. */
export function configureAdminAlertChannel(deps: SharedMetaCredentials & SharedEvolutionCredentials): void {
  sharedMeta = { metaAccessToken: deps.metaAccessToken, metaPhoneNumberId: deps.metaPhoneNumberId };
  sharedEvo = {
    evolutionInstanceName: deps.evolutionInstanceName,
    evolutionApiUrl: deps.evolutionApiUrl,
    evolutionApiKey: deps.evolutionApiKey,
  };
}

/** Só pra testes — reseta a config global entre casos. */
export function resetAdminAlertChannelForTests(): void {
  sharedMeta = {};
  sharedEvo = {};
}

export interface AdminAlertMessage {
  /** Nome do template aprovado no Meta Business Manager — usado só quando o canal do tenant é Meta. */
  templateName: string;
  templateLanguage: string;
  templateArgs: string[];
  /** Mesmo conteúdo em texto livre — usado quando o canal do tenant é Evolution API. */
  freeText: string;
}

/**
 * Manda o alerta pro admin_alert_phone do tenant, pelo canal real dele.
 * `overrideDeps` (opcional) tem prioridade sobre a config global — usado
 * por agentPausedAlertJob.ts, que já recebe credenciais por chamada.
 * Nunca engole erro sozinho — quem chama decide como logar a falha, mesmo
 * padrão que já existia antes desta extração.
 */
export async function sendAdminAlert(
  tenantId: string,
  adminPhone: string,
  message: AdminAlertMessage,
  overrideDeps?: SharedMetaCredentials & SharedEvolutionCredentials
): Promise<void> {
  const meta: SharedMetaCredentials = overrideDeps
    ? { metaAccessToken: overrideDeps.metaAccessToken, metaPhoneNumberId: overrideDeps.metaPhoneNumberId }
    : sharedMeta;
  const evo: SharedEvolutionCredentials = overrideDeps
    ? {
        evolutionInstanceName: overrideDeps.evolutionInstanceName,
        evolutionApiUrl: overrideDeps.evolutionApiUrl,
        evolutionApiKey: overrideDeps.evolutionApiKey,
      }
    : sharedEvo;

  const channel = await resolveCredentialsForTenant(tenantId, meta, evo);

  if (channel.provider === 'evolution') {
    await sendEvolutionTextMessage(channel.evolutionInstanceName, channel.evolutionApiUrl, channel.evolutionApiKey, adminPhone, message.freeText);
    return;
  }

  await sendWhatsAppTemplateMessage(channel.metaPhoneNumberId, channel.metaAccessToken, adminPhone, message.templateName, message.templateLanguage, message.templateArgs);
}
